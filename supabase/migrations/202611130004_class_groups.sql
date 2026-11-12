begin;
create table if not exists public.academy_class_groups (
 id uuid primary key default gen_random_uuid(),
 branch_id bigint not null references public.branches(id),
 name text not null check(length(trim(name))>0),
 subject text not null check(length(trim(subject))>0),
 weekday integer not null check(weekday between 0 and 6),
 start_time time not null,end_time time not null,
 teacher_id uuid references public.profiles(id),
 room text not null default '',active boolean not null default true,
 created_at timestamptz not null default now(),check(end_time>start_time)
);
create table if not exists public.academy_class_group_students (
 group_id uuid not null references public.academy_class_groups(id) on delete cascade,
 student_id bigint not null references public.students(id),primary key(group_id,student_id)
);
alter table public.academy_class_groups enable row level security;
alter table public.academy_class_group_students enable row level security;
revoke all on public.academy_class_groups,public.academy_class_group_students from public,anon,authenticated;
alter table public.lessons add column if not exists class_group_id uuid references public.academy_class_groups(id);
alter table public.lessons add column if not exists end_time time;
create unique index if not exists lessons_class_group_date on public.lessons(class_group_id,date) where class_group_id is not null;
create sequence if not exists public.class_group_lesson_ids start 9100000000000;
revoke all on sequence public.class_group_lesson_ids from public,anon,authenticated;

create or replace function public.list_class_groups(p_branch_id bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles%rowtype; result jsonb;
begin
 select * into actor from public.profiles where id=auth.uid();
 if not found or actor.role is null or actor.role not in ('owner','manager','admin') then raise exception 'Staff access required'; end if;
 if p_branch_id is null or (actor.role<>'owner' and p_branch_id is distinct from actor.branch_id) then raise exception 'Branch access denied'; end if;
 select coalesce(jsonb_agg(to_jsonb(g)||jsonb_build_object('student_ids',
 (select coalesce(jsonb_agg(r.student_id order by r.student_id),'[]'::jsonb) from public.academy_class_group_students r where r.group_id=g.id)) order by g.active desc,g.weekday,g.start_time,g.name),'[]'::jsonb)
 into result from public.academy_class_groups g where g.branch_id=p_branch_id;
 return result;
end $$;

create or replace function public.save_class_group(
 p_group_id uuid,p_branch_id bigint,p_name text,p_subject text,p_weekday integer,
 p_start_time time,p_end_time time,p_teacher_id uuid,p_room text,p_active boolean,p_student_ids bigint[]
) returns uuid language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype; group_record public.academy_class_groups%rowtype; gid uuid; ids bigint[];
begin
 select * into actor from public.profiles where id=auth.uid();
 if not found or actor.role is null or actor.role not in ('owner','manager','admin') then raise exception 'Staff access required'; end if;
 if p_branch_id is null or (actor.role<>'owner' and p_branch_id is distinct from actor.branch_id) then raise exception 'Branch access denied'; end if;
 perform pg_advisory_xact_lock(7362921);
 if p_group_id is not null then
  select * into group_record from public.academy_class_groups where id=p_group_id for update;
  if not found or group_record.branch_id is distinct from p_branch_id then raise exception 'Group not found in this branch'; end if;
 end if;
 select coalesce(array_agg(distinct x),'{}'::bigint[]) into ids from unnest(coalesce(p_student_ids,'{}'::bigint[])) x;
 if cardinality(ids)>8 then raise exception 'Maximum 8 students per group'; end if;
 if p_name is null or trim(p_name)='' or p_subject is null or trim(p_subject)='' then raise exception 'Enter a group name and subject'; end if;
 if p_weekday is null or p_weekday not between 0 and 6 or p_start_time is null or p_end_time is null or p_end_time<=p_start_time then raise exception 'Choose a day and an end time after the start time'; end if;
 if p_teacher_id is not null and not exists(select 1 from public.profiles where id=p_teacher_id and role='teacher' and branch_id=p_branch_id) then raise exception 'Choose a teacher from this branch'; end if;
 if exists(select 1 from unnest(ids) sid where not exists(select 1 from public.students s where s.id=sid and s.branch_id=p_branch_id and s.status='Active' and (s.total-s.sessions_used>0 or exists(select 1 from public.academy_class_group_students m where m.group_id=p_group_id and m.student_id=s.id)))) then raise exception 'New members must be active students with sessions remaining in this branch'; end if;
 if coalesce(p_active,true) and exists(
  select 1 from public.academy_class_groups g where g.branch_id=p_branch_id and g.active and (p_group_id is null or g.id<>p_group_id)
  and g.weekday=p_weekday and g.start_time<p_end_time and g.end_time>p_start_time
  and ((p_teacher_id is not null and g.teacher_id=p_teacher_id) or exists(select 1 from public.academy_class_group_students m where m.group_id=g.id and m.student_id=any(ids)))
 ) then raise exception 'A teacher or student is already assigned to an overlapping weekly group'; end if;
 gid:=coalesce(p_group_id,gen_random_uuid());
 insert into public.academy_class_groups(id,branch_id,name,subject,weekday,start_time,end_time,teacher_id,room,active)
 values(gid,p_branch_id,trim(p_name),p_subject,p_weekday,p_start_time,p_end_time,p_teacher_id,coalesce(p_room,''),coalesce(p_active,true))
 on conflict(id) do update set name=excluded.name,subject=excluded.subject,weekday=excluded.weekday,start_time=excluded.start_time,end_time=excluded.end_time,teacher_id=excluded.teacher_id,room=excluded.room,active=excluded.active;
 delete from public.academy_class_group_students where group_id=gid;
 insert into public.academy_class_group_students select gid,x from unnest(ids) x;
 return gid;
end $$;

create or replace function public.schedule_class_group(p_group_id uuid,p_from date,p_weeks integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype; g public.academy_class_groups%rowtype;
 ids bigint[]; day_date date; first_date date; lid bigint; i integer; created_count integer:=0; skipped_count integer:=0; existing_count integer:=0;
begin
 select * into actor from public.profiles where id=auth.uid();
 if not found or actor.role is null or actor.role not in ('owner','manager','admin') then raise exception 'Staff access required'; end if;
 perform pg_advisory_xact_lock(7362921);
 select * into g from public.academy_class_groups where id=p_group_id for update;
 if not found or not g.active then raise exception 'Choose an active group'; end if;
 if actor.role<>'owner' and g.branch_id is distinct from actor.branch_id then raise exception 'Branch access denied'; end if;
 if p_from is null or p_from<timezone('Asia/Bangkok',now())::date or p_weeks is null or p_weeks<1 or p_weeks>26 then raise exception 'Choose today or a future date and 1–26 weeks'; end if;
 select array_agg(m.student_id) into ids from public.academy_class_group_students m join public.students s on s.id=m.student_id where m.group_id=g.id and s.status='Active' and s.branch_id=g.branch_id;
 if coalesce(cardinality(ids),0)=0 then raise exception 'Add active students to this group first'; end if;
 first_date:=p_from+((g.weekday-extract(dow from p_from)::integer+7)%7);
 for i in 0..p_weeks-1 loop
  day_date:=first_date+i*7;
  if exists(select 1 from public.lessons where class_group_id=g.id and date=day_date) then existing_count:=existing_count+1;continue;end if;
  if exists(select 1 from public.extras where branch_id=g.branch_id and type='Holidays' and date=day_date) then skipped_count:=skipped_count+1;continue;end if;
  if exists(select 1 from public.lessons l where l.date=day_date
    and l.time<g.end_time and coalesce(l.end_time,(l.time+interval '90 minutes')::time)>g.start_time
    and ((g.teacher_id is not null and l.teacher_id=g.teacher_id) or exists(select 1 from public.lesson_students r where r.lesson_id=l.id and r.student_id=any(ids))))
   then raise exception 'Teacher or student has an overlapping lesson on %. No new lessons were saved.',day_date;end if;
  lid:=nextval('public.class_group_lesson_ids');
  insert into public.lessons(id,branch_id,subject,title,date,time,end_time,teacher_id,room,class_group_id)
   values(lid,g.branch_id,g.subject,g.name,day_date,g.start_time,g.end_time,g.teacher_id,g.room,g.id);
  insert into public.lesson_students(branch_id,lesson_id,student_id) select g.branch_id,lid,x from unnest(ids) x;
  created_count:=created_count+1;
 end loop;
 return jsonb_build_object('created',created_count,'holidays_skipped',skipped_count,'already_scheduled',existing_count);
end $$;
revoke all on function public.list_class_groups(bigint),public.save_class_group(uuid,bigint,text,text,integer,time,time,uuid,text,boolean,bigint[]),public.schedule_class_group(uuid,date,integer) from public,anon;
grant execute on function public.list_class_groups(bigint),public.save_class_group(uuid,bigint,text,text,integer,time,time,uuid,text,boolean,bigint[]),public.schedule_class_group(uuid,date,integer) to authenticated;
notify pgrst,'reload schema';
commit;
