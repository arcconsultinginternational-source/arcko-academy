begin;
lock table public.students in access exclusive mode;

-- Private audit copy of the old identifiers; no public lookup permissions.
create table if not exists public.student_id_change_history (
 student_id bigint not null,
 previous_code text not null,
 changed_at timestamptz not null default now(),
 primary key(student_id, previous_code)
);
alter table public.student_id_change_history enable row level security;
revoke all on public.student_id_change_history from public,anon,authenticated;
insert into public.student_id_change_history(student_id,previous_code)
select id,student_code from public.students where student_code is not null
on conflict do nothing;

create table if not exists public.student_monthly_id_counters (
 enrollment_month date primary key,
 last_number bigint not null check(last_number>=1)
);
alter table public.student_monthly_id_counters enable row level security;
revoke all on public.student_monthly_id_counters from public,anon,authenticated;

create or replace function public.assign_arcko_student_code()
returns trigger language plpgsql security definer set search_path='' as $$
declare n bigint; month_start date; candidate text;
begin
 if TG_OP='UPDATE' and OLD.student_code is not null then
  if NEW.student_code is distinct from OLD.student_code or NEW.enrollment_date is distinct from OLD.enrollment_date then
   raise exception 'Student ID and enrollment date cannot change';
  end if;
  return NEW;
 end if;
 NEW.enrollment_date:=coalesce(NEW.enrollment_date,timezone('Asia/Bangkok',now())::date);
 month_start:=date_trunc('month',NEW.enrollment_date)::date;
 loop
  insert into public.student_monthly_id_counters values(month_start,1)
  on conflict(enrollment_month) do update
   set last_number=public.student_monthly_id_counters.last_number+1
  returning last_number into n;
  candidate:='AR'||case when n<1000 then lpad(n::text,3,'0') else n::text end||to_char(NEW.enrollment_date,'MMYY');
  exit when not exists(select 1 from public.students where student_code=candidate);
 end loop;
 NEW.student_code:=candidate;
 return NEW;
end $$;
revoke all on function public.assign_arcko_student_code() from public,anon,authenticated;

-- Run-once conversion. Re-running the script preserves already converted IDs.
do $$
declare r record;
begin
 if not exists(select 1 from public.student_monthly_id_counters) then
  execute 'drop trigger if exists arcko_student_code on public.students';
  execute 'alter table public.students alter column student_code drop not null';
  update public.students set student_code=null;
  execute 'create trigger arcko_student_code before insert or update on public.students for each row execute function public.assign_arcko_student_code()';
  for r in select id from public.students order by enrollment_date,id loop
   update public.students set student_code=null where id=r.id;
  end loop;
  execute 'alter table public.students alter column student_code set not null';
 end if;
end $$;

create or replace function public.lookup_student_journey(p_student_code text)
returns table(attended bigint,classes_left bigint,coins bigint)
language sql stable security definer set search_path='' as $$
 select coalesce(s.sessions_used,0)::bigint,
 (coalesce(s.total,0)-coalesce(s.sessions_used,0))::bigint,
 coalesce(s.coins,0)::bigint
 from public.students s
 where upper(trim(p_student_code)) ~ '^AR[0-9]{7,16}$'
 and s.student_code=upper(trim(p_student_code)) and s.status='Active'
 limit 1;
$$;
revoke all on function public.lookup_student_journey(text) from public;
grant execute on function public.lookup_student_journey(text) to anon,authenticated;
notify pgrst, 'reload schema';
commit;
