begin;
alter table public.students add column if not exists student_code text;
alter table public.students add column if not exists enrollment_date date;
-- Preserve existing dates when available; otherwise use the migration date.
update public.students s set enrollment_date=coalesce(s.enrollment_date,(to_jsonb(s)->>'created_at')::timestamptz at time zone 'Asia/Bangkok',timezone('Asia/Bangkok',now()))::date where enrollment_date is null;
alter table public.students alter column enrollment_date set default (timezone('Asia/Bangkok',now())::date);
create table if not exists public.student_code_counters(enrollment_date date primary key,last_number bigint not null);
alter table public.student_code_counters enable row level security;
revoke all on public.student_code_counters from public,anon,authenticated;
create or replace function public.assign_arcko_student_code() returns trigger language plpgsql security definer set search_path='' as $$
declare n bigint; candidate text;
begin
 if TG_OP='UPDATE' and OLD.student_code is not null then
  if NEW.student_code is distinct from OLD.student_code or NEW.enrollment_date is distinct from OLD.enrollment_date then raise exception 'Student ID and enrollment date cannot change'; end if;
  return NEW;
 end if;
 NEW.enrollment_date:=coalesce(NEW.enrollment_date,timezone('Asia/Bangkok',now())::date);
 loop
  insert into public.student_code_counters values(NEW.enrollment_date,0)
  on conflict(enrollment_date) do update set last_number=public.student_code_counters.last_number+1 returning last_number into n;
  candidate:='AR'||case when n<10 then '0'||n::text else n::text end||to_char(NEW.enrollment_date,'DDMMYY');
  exit when not exists(select 1 from public.students where student_code=candidate);
 end loop;
 NEW.student_code:=candidate;
 return NEW;
end $$;
revoke all on function public.assign_arcko_student_code() from public,anon,authenticated;
drop trigger if exists arcko_student_code on public.students;
create trigger arcko_student_code before insert or update on public.students for each row execute function public.assign_arcko_student_code();
-- Assign missing IDs deterministically, preserving existing student IDs and history.
do $$ declare r record; begin for r in select id from public.students where student_code is null order by enrollment_date,id loop update public.students set student_code=null where id=r.id; end loop; end $$;
create unique index if not exists students_student_code_unique on public.students(student_code);
alter table public.students alter column student_code set not null;
create or replace function public.lookup_student_journey(p_student_code text)
returns table(attended bigint,classes_left bigint,coins bigint)
language sql stable security definer set search_path='' as $$
 select coalesce(s.sessions_used,0)::bigint,
 (coalesce(s.total,0)-coalesce(s.sessions_used,0))::bigint,
 coalesce(s.coins,0)::bigint
 from public.students s
 where upper(trim(p_student_code)) ~ '^AR[0-9]{8,16}$'
 and s.student_code=upper(trim(p_student_code)) and s.status='Active'
 limit 1;
$$;
revoke all on function public.lookup_student_journey(text) from public;
grant execute on function public.lookup_student_journey(text) to anon,authenticated;
comment on function public.lookup_student_journey(text) is 'Public read-only exact-ID lookup. Only attended classes, remaining classes and coins; no student or contact details.';
commit;
