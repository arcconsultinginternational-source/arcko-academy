begin;

alter table public.lessons add column if not exists trial_guests jsonb not null default '[]'::jsonb;
create table if not exists public.paid_enrolment_requests (
 request_id uuid primary key,
 actor_id uuid not null,
 student_id bigint not null references public.students(id),
 invoice_id text not null,
 created_at timestamptz not null default now()
);
alter table public.paid_enrolment_requests enable row level security;
revoke all on public.paid_enrolment_requests from public,anon,authenticated;
create sequence if not exists public.paid_enrolment_lesson_ids start 9000000000000;
revoke all on sequence public.paid_enrolment_lesson_ids from public,anon,authenticated;

create or replace function public.enrol_after_payment(
 p_request_id uuid,p_student_id bigint,p_subject text,p_sessions integer,
 p_price numeric,p_discount numeric,p_amount_received numeric,
 p_method text,p_payment_date date,p_first_date date,p_first_time time,
 p_teacher_id uuid,p_confirmed boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype; learner public.students%rowtype;
 previous public.paid_enrolment_requests%rowtype;
 invoice_number text; lesson_number bigint; amount_due numeric;
begin
 select * into actor from public.profiles where id=auth.uid();
 if not found or actor.role is null or actor.role not in ('owner','manager','admin') then raise exception 'Only owner, manager or admin can confirm paid enrolment'; end if;
 if p_request_id is null then raise exception 'Missing request ID'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into previous from public.paid_enrolment_requests where request_id=p_request_id;
 if found then
  if previous.actor_id<>actor.id or previous.student_id<>p_student_id then raise exception 'Request ID already used'; end if;
  return jsonb_build_object('invoice_id',previous.invoice_id,'already_saved',true);
 end if;
 select * into learner from public.students where id=p_student_id for update;
 if not found then raise exception 'Student not found'; end if;
 if actor.role<>'owner' and learner.branch_id is distinct from actor.branch_id then raise exception 'Student is outside your branch'; end if;
 if learner.status is distinct from 'Active' then raise exception 'Activate the student before enrolment'; end if;
 if p_confirmed is distinct from true then raise exception 'Confirm full payment has been received'; end if;
 if p_sessions is null or p_sessions<1 or p_sessions>1000 then raise exception 'Sessions must be 1 to 1000'; end if;
 if p_price is null or p_discount is null or p_amount_received is null or p_price::text in ('NaN','Infinity','-Infinity') or p_discount::text in ('NaN','Infinity','-Infinity') or p_amount_received::text in ('NaN','Infinity','-Infinity') then raise exception 'Enter valid payment amounts'; end if;
 amount_due:=round(p_price-p_discount,2);
 if p_price<=0 or p_discount<0 or amount_due<=0 or round(p_amount_received,2)<>amount_due then raise exception 'Full payment must equal the package price minus discount'; end if;
 if p_method is null or p_method not in ('Bank transfer','Cash','PromptPay','Card') then raise exception 'Choose a payment method'; end if;
 if p_payment_date is null or p_payment_date>timezone('Asia/Bangkok',now())::date then raise exception 'Payment date cannot be in the future'; end if;
 if p_first_date is null or p_first_time is null or p_subject is null or trim(p_subject)='' then raise exception 'Choose the programme and first class'; end if;
 -- Serialize same-teacher bookings in this endpoint before checking conflicts.
 if p_teacher_id is not null then
  perform pg_advisory_xact_lock(hashtextextended(p_teacher_id::text,1));
  if not exists(select 1 from public.profiles where id=p_teacher_id and role='teacher' and branch_id=learner.branch_id) then raise exception 'Choose a teacher from this branch'; end if;
  if exists(select 1 from public.lessons where teacher_id=p_teacher_id and date=p_first_date and time=p_first_time) then raise exception 'Teacher already has a class at this time'; end if;
 end if;
 if exists(select 1 from public.lesson_students r join public.lessons l on l.id=r.lesson_id where r.student_id=p_student_id and l.date=p_first_date and l.time=p_first_time) then raise exception 'Student already has a class at this time'; end if;
 if exists(select 1 from public.extras where branch_id=learner.branch_id and type='Holidays' and date=p_first_date) then raise exception 'The academy is closed on that date'; end if;
 insert into public.invoices(branch_id,student_id,subject,amount,status,date,due,method)
 values(learner.branch_id,learner.id,p_subject,amount_due,'Paid',p_payment_date,p_payment_date,p_method)
 returning id into invoice_number;
 update public.students set subject=p_subject,total=coalesce(total,0)+p_sessions where id=learner.id;
 lesson_number:=nextval('public.paid_enrolment_lesson_ids');
 insert into public.lessons(id,branch_id,subject,title,date,time,teacher_id,room,trial_guests)
 values(lesson_number,learner.branch_id,p_subject,'Paid enrolment',p_first_date,p_first_time,p_teacher_id,'','[]'::jsonb);
 insert into public.lesson_students(branch_id,lesson_id,student_id) values(learner.branch_id,lesson_number,learner.id);
 insert into public.paid_enrolment_requests(request_id,actor_id,student_id,invoice_id)
 values(p_request_id,actor.id,learner.id,invoice_number);
 return jsonb_build_object('invoice_id',invoice_number,'already_saved',false);
end $$;
revoke all on function public.enrol_after_payment(uuid,bigint,text,integer,numeric,numeric,numeric,text,date,date,time,uuid,boolean) from public,anon;
grant execute on function public.enrol_after_payment(uuid,bigint,text,integer,numeric,numeric,numeric,text,date,date,time,uuid,boolean) to authenticated;
notify pgrst, 'reload schema';

create or replace function public.dashboard_collected_revenue(p_branch_id bigint)
returns numeric language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles%rowtype; result numeric;
begin
 select * into actor from public.profiles where id=auth.uid();
 if not found or actor.role is null or actor.role not in ('owner','manager','admin') then raise exception 'Staff access required'; end if;
 if p_branch_id is null or (actor.role<>'owner' and p_branch_id is distinct from actor.branch_id) then raise exception 'Branch access denied'; end if;
 select coalesce(sum(amount),0) into result from public.invoices where branch_id=p_branch_id and status='Paid';
 return result;
end $$;
revoke all on function public.dashboard_collected_revenue(bigint) from public,anon;
grant execute on function public.dashboard_collected_revenue(bigint) to authenticated;

create or replace function public.lookup_student_journey_v2(p_student_code text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare learner public.students%rowtype; maps jsonb; dated_count bigint;
begin
 if upper(trim(p_student_code)) !~ '^AR[0-9]{7,16}$' then return null; end if;
 select * into learner from public.students where student_code=upper(trim(p_student_code)) and status='Active';
 if not found then return null; end if;
 with subjects as (
  select learner.subject as subject where coalesce(learner.total,0)>0
  union select i.subject from public.invoices i where i.student_id=learner.id and i.status='Paid' and i.branch_id=learner.branch_id
  union select l.subject from public.lesson_students r join public.lessons l on l.id=r.lesson_id
    where r.student_id=learner.id and l.branch_id=learner.branch_id
 ), records as (
  select l.subject,l.date,l.time,l.id from public.attendance a
  join public.lessons l on l.id=a.lesson_id
  where a.student_id=learner.id and a.status='Present' and l.branch_id=learner.branch_id
    and l.date<=timezone('Asia/Bangkok',now())::date
 ), all_subjects as (
  select subject from subjects union select subject from records
 )
 select coalesce(jsonb_agg(jsonb_build_object('subject',s.subject,'dates',
  (select coalesce(jsonb_agg(r.date order by r.date,r.time,r.id),'[]'::jsonb) from records r where r.subject=s.subject)) order by s.subject),'[]'::jsonb)
 into maps from all_subjects s where s.subject is not null and trim(s.subject)<>'';
 select coalesce(sum(jsonb_array_length(x->'dates')),0) into dated_count from jsonb_array_elements(maps) x;
 return jsonb_build_object('attended',coalesce(learner.sessions_used,0),'classes_left',coalesce(learner.total,0)-coalesce(learner.sessions_used,0),
  'coins',coalesce(learner.coins,0),'programmes',maps,'undated_attended',greatest(0,coalesce(learner.sessions_used,0)-dated_count));
end $$;
revoke all on function public.lookup_student_journey_v2(text) from public;
grant execute on function public.lookup_student_journey_v2(text) to anon,authenticated;
notify pgrst,'reload schema';


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


-- Requires the class groups and paid enrolment migrations already supplied.
create or replace function public.enrol_in_class_group(
 p_request_id uuid,p_student_id bigint,p_group_id uuid,p_sessions integer,
 p_price numeric,p_discount numeric,p_amount_received numeric,
 p_method text,p_payment_date date,p_from date,p_confirmed boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype; learner public.students%rowtype;
 previous public.paid_enrolment_requests%rowtype;
 invoice_number text; amount_due numeric; g public.academy_class_groups%rowtype; first_date date; lesson record; tries integer:=0;
begin
 select * into actor from public.profiles where id=auth.uid();
 if not found or actor.role is null or actor.role not in ('owner','manager','admin') then raise exception 'Only owner, manager or admin can confirm paid enrolment'; end if;
 if p_request_id is null then raise exception 'Missing request ID'; end if;
 perform pg_advisory_xact_lock(7362921);
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into previous from public.paid_enrolment_requests where request_id=p_request_id;
 if found then
  if previous.actor_id<>actor.id or previous.student_id<>p_student_id then raise exception 'Request ID already used'; end if;
  return jsonb_build_object('invoice_id',previous.invoice_id,'already_saved',true);
 end if;
 select * into learner from public.students where id=p_student_id for update;
 if not found then raise exception 'Student not found'; end if;
 if actor.role<>'owner' and learner.branch_id is distinct from actor.branch_id then raise exception 'Student is outside your branch'; end if;
 if learner.status is distinct from 'Active' then raise exception 'Activate the student before enrolment'; end if;
 if p_confirmed is distinct from true then raise exception 'Confirm full payment has been received'; end if;
 if p_sessions is null or p_sessions<1 or p_sessions>1000 then raise exception 'Sessions must be 1 to 1000'; end if;
 if p_price is null or p_discount is null or p_amount_received is null or p_price::text in ('NaN','Infinity','-Infinity') or p_discount::text in ('NaN','Infinity','-Infinity') or p_amount_received::text in ('NaN','Infinity','-Infinity') then raise exception 'Enter valid payment amounts'; end if;
 amount_due:=round(p_price-p_discount,2);
 if p_price<=0 or p_discount<0 or amount_due<=0 or round(p_amount_received,2)<>amount_due then raise exception 'Full payment must equal the package price minus discount'; end if;
 if p_method is null or p_method not in ('Bank transfer','Cash','PromptPay','Card') then raise exception 'Choose a payment method'; end if;
 if p_payment_date is null or p_payment_date>timezone('Asia/Bangkok',now())::date then raise exception 'Payment date cannot be in the future'; end if;
 if p_from is null or p_from<timezone('Asia/Bangkok',now())::date then raise exception 'Choose today or a future start date'; end if;
 select * into g from public.academy_class_groups where id=p_group_id for update;
 if not found or not g.active or g.branch_id is distinct from learner.branch_id then raise exception 'Choose an active class group in the student branch'; end if;
 if not exists(select 1 from public.academy_class_group_students where group_id=g.id and student_id=learner.id)
 and (select count(*) from public.academy_class_group_students where group_id=g.id)>=8 then raise exception 'This group is full (maximum 8 students)'; end if;
 -- Reject clashes with any other standing weekly group before charging/recording anything.
 if exists(select 1 from public.academy_class_group_students m join public.academy_class_groups other_group on other_group.id=m.group_id
  where m.student_id=learner.id and other_group.id<>g.id and other_group.active and other_group.weekday=g.weekday
  and other_group.start_time<g.end_time and other_group.end_time>g.start_time) then raise exception 'Student belongs to another overlapping weekly group'; end if;
 first_date:=p_from+((g.weekday-extract(dow from p_from)::integer+7)%7);
 while exists(select 1 from public.extras where branch_id=g.branch_id and type='Holidays' and date=first_date) loop
  first_date:=first_date+7;tries:=tries+1;if tries>52 then raise exception 'No available class date within the next year';end if;
 end loop;
 insert into public.invoices(branch_id,student_id,subject,amount,status,date,due,method)
 values(learner.branch_id,learner.id,g.subject,amount_due,'Paid',p_payment_date,p_payment_date,p_method)
 returning id into invoice_number;
 update public.students set subject=g.subject,total=coalesce(total,0)+p_sessions where id=learner.id;
 insert into public.academy_class_group_students(group_id,student_id) values(g.id,learner.id) on conflict do nothing;
 -- Create the first group date only if it has not already been scheduled.
 perform public.schedule_class_group(g.id,first_date,1);
 -- Join all already-scheduled future lessons from the requested starting point.
 -- Existing dates, times, teachers and other students are preserved.
 for lesson in select * from public.lessons where class_group_id=g.id and date>=first_date order by date,time for update loop
  if exists(select 1 from public.lesson_students where lesson_id=lesson.id and student_id=learner.id) then continue; end if;
  if (select count(*) from public.lesson_students where lesson_id=lesson.id)+jsonb_array_length(coalesce(lesson.trial_guests,'[]'::jsonb))>=8 then raise exception 'The class on % is full. Nothing was saved.',lesson.date;end if;
  if exists(select 1 from public.lesson_students r join public.lessons other_lesson on other_lesson.id=r.lesson_id
   where r.student_id=learner.id and other_lesson.id<>lesson.id and other_lesson.date=lesson.date
   and other_lesson.time::time<coalesce(lesson.end_time,(lesson.time::time+interval '90 minutes')::time)
   and coalesce(other_lesson.end_time,(other_lesson.time::time+interval '90 minutes')::time)>lesson.time::time) then raise exception 'Student has an overlapping lesson on %. Nothing was saved.',lesson.date;end if;
  insert into public.lesson_students(branch_id,lesson_id,student_id) values(g.branch_id,lesson.id,learner.id);
 end loop;
 insert into public.paid_enrolment_requests(request_id,actor_id,student_id,invoice_id)
 values(p_request_id,actor.id,learner.id,invoice_number);
 return jsonb_build_object('invoice_id',invoice_number,'already_saved',false,'group_name',g.name,'first_date',first_date);
end $$;
revoke all on function public.enrol_in_class_group(uuid,bigint,uuid,integer,numeric,numeric,numeric,text,date,date,boolean) from public,anon;
grant execute on function public.enrol_in_class_group(uuid,bigint,uuid,integer,numeric,numeric,numeric,text,date,date,boolean) to authenticated;
notify pgrst,'reload schema';

create table if not exists public.academy_class_group_guests (
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public.academy_class_groups(id),
 lesson_id bigint not null references public.lessons(id) on delete cascade,
 kind text not null check(kind in ('trial','reschedule')),
 student_id bigint references public.students(id),lead_id bigint,
 guest_name text not null,remark text not null default '',
 source_lesson_id bigint references public.lessons(id) on delete set null,
 original_status text,
 created_at timestamptz not null default now(),created_by uuid not null references public.profiles(id)
);
alter table public.academy_class_group_guests enable row level security;
revoke all on public.academy_class_group_guests from public,anon,authenticated;
create unique index if not exists group_trial_guest_once on public.academy_class_group_guests(lesson_id,lead_id) where kind='trial';
create unique index if not exists group_reschedule_guest_once on public.academy_class_group_guests(lesson_id,student_id) where kind='reschedule';

create or replace function public.list_class_group_guests(p_branch_id bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles%rowtype; result jsonb;
begin
 select * into actor from public.profiles where id=auth.uid();
 if not found or actor.role is null or actor.role not in ('owner','manager','admin','teacher') then raise exception 'Staff access required';end if;
 if p_branch_id is null or (actor.role<>'owner' and p_branch_id is distinct from actor.branch_id) then raise exception 'Branch access denied';end if;
 select coalesce(jsonb_agg(to_jsonb(g) order by l.date,l.time::time,g.created_at),'[]'::jsonb) into result
 from public.academy_class_group_guests g join public.lessons l on l.id=g.lesson_id
 where l.branch_id=p_branch_id and (actor.role<>'teacher' or l.teacher_id=actor.id)
 and ((g.kind='trial' and exists(select 1 from jsonb_array_elements(coalesce(l.trial_guests,'[]'::jsonb)) t where t->>'leadId'=g.lead_id::text))
 or (g.kind='reschedule' and exists(select 1 from public.lesson_students r where r.lesson_id=l.id and r.student_id=g.student_id)));
 return result;
end $$;

create or replace function public.add_class_group_guest(
 p_group_id uuid,p_lesson_id bigint,p_kind text,p_student_id bigint,p_lead_id bigint,p_source_lesson_id bigint,p_remark text
) returns uuid language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype; g public.academy_class_groups%rowtype;
 target public.lessons%rowtype; original public.lessons%rowtype; learner public.students%rowtype;
 lead_record public.leads%rowtype; name_text text; gid uuid; previous_status text;
begin
 select * into actor from public.profiles where id=auth.uid();
 if not found or actor.role is null or actor.role not in ('owner','manager','admin') then raise exception 'Owner, manager or admin access required';end if;
 perform pg_advisory_xact_lock(7362921);
 select * into g from public.academy_class_groups where id=p_group_id for update;
 if not found or not g.active then raise exception 'Choose an active class group';end if;
 if actor.role<>'owner' and g.branch_id is distinct from actor.branch_id then raise exception 'Branch access denied';end if;
 select * into target from public.lessons where id=p_lesson_id and class_group_id=g.id for update;
 if not found or target.date<timezone('Asia/Bangkok',now())::date then raise exception 'Choose an upcoming lesson in this group';end if;
 if p_kind is null or p_kind not in ('trial','reschedule') then raise exception 'Choose Trial or Rescheduled student';end if;
 if length(coalesce(p_remark,''))>1000 then raise exception 'Remark must be 1000 characters or less';end if;
 if (select count(*) from public.lesson_students where lesson_id=target.id)+jsonb_array_length(coalesce(target.trial_guests,'[]'::jsonb))>=8 then raise exception 'This lesson is full (maximum 8 students including guests)';end if;
 if p_kind='trial' then
  select * into lead_record from public.leads where id=p_lead_id and branch_id=g.branch_id for update;
  if not found or lead_record.status in ('Closed lost','Not interested') then raise exception 'Choose an open lead from this branch';end if;
  if exists(select 1 from jsonb_array_elements(coalesce(target.trial_guests,'[]'::jsonb)) t where t->>'leadId'=lead_record.id::text) then raise exception 'This lead is already booked in this lesson';end if;
  if exists(select 1 from public.lessons l cross join lateral jsonb_array_elements(coalesce(l.trial_guests,'[]'::jsonb)) t
   where l.id<>target.id and t->>'leadId'=lead_record.id::text and l.date=target.date
   and l.time::time<coalesce(target.end_time,(target.time::time+interval '90 minutes')::time)
   and coalesce(l.end_time,(l.time::time+interval '90 minutes')::time)>target.time::time) then raise exception 'This lead has another trial at the same time';end if;
  name_text:=coalesce(nullif(lead_record.child,''),lead_record.name);
  update public.lessons set trial_guests=coalesce(trial_guests,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('leadId',lead_record.id,'name',name_text,'status','Not marked','remark',coalesce(p_remark,''))) where id=target.id;
  update public.leads set status='Trial booked' where id=lead_record.id;
  insert into public.academy_class_group_guests(group_id,lesson_id,kind,lead_id,guest_name,remark,created_by)
   values(g.id,target.id,'trial',lead_record.id,name_text,coalesce(p_remark,''),actor.id)
   on conflict(lesson_id,lead_id) where kind='trial' do update set remark=excluded.remark,guest_name=excluded.guest_name,created_at=now(),created_by=excluded.created_by
   returning id into gid;
 else
  select * into learner from public.students where id=p_student_id and branch_id=g.branch_id for update;
  if not found or learner.status is distinct from 'Active' or learner.total-learner.sessions_used<1 then raise exception 'Choose an active paid student with sessions remaining';end if;
  if p_source_lesson_id is null or p_source_lesson_id=target.id then raise exception 'Choose a different original lesson';end if;
  select * into original from public.lessons where id=p_source_lesson_id and branch_id=g.branch_id for update;
  if not found or not exists(select 1 from public.lesson_students where lesson_id=original.id and student_id=learner.id) then raise exception 'Choose an upcoming original lesson containing this student';end if;
  if original.subject is distinct from target.subject then raise exception 'Reschedule into a group for the same subject';end if;
  select status::text into previous_status from public.attendance where lesson_id=original.id and student_id=learner.id;
  if previous_status='Present' then raise exception 'An attended lesson cannot be rescheduled';end if;
  if original.date<timezone('Asia/Bangkok',now())::date and coalesce(previous_status,'') not in ('Absent','Excused') then raise exception 'Mark the past original lesson Absent or Excused before arranging a make-up';end if;
  if exists(select 1 from public.lesson_students where lesson_id=target.id and student_id=learner.id) then raise exception 'Student is already in this destination lesson';end if;
  if exists(select 1 from public.lesson_students r join public.lessons l on l.id=r.lesson_id where r.student_id=learner.id
   and l.id<>original.id and l.id<>target.id and l.date=target.date
   and l.time::time<coalesce(target.end_time,(target.time::time+interval '90 minutes')::time)
   and coalesce(l.end_time,(l.time::time+interval '90 minutes')::time)>target.time::time) then raise exception 'Student already has an overlapping lesson';end if;
  -- Preserve the source and its prior non-Present status in the private transfer log.
  delete from public.attendance where lesson_id=original.id and student_id=learner.id;
  delete from public.lesson_students where lesson_id=original.id and student_id=learner.id;
  insert into public.lesson_students(branch_id,lesson_id,student_id) values(g.branch_id,target.id,learner.id);
  insert into public.academy_class_group_guests(group_id,lesson_id,kind,student_id,guest_name,remark,source_lesson_id,original_status,created_by)
   values(g.id,target.id,'reschedule',learner.id,learner.name,coalesce(p_remark,''),original.id,previous_status,actor.id)
   on conflict(lesson_id,student_id) where kind='reschedule' do update set remark=excluded.remark,source_lesson_id=excluded.source_lesson_id,original_status=excluded.original_status,created_at=now(),created_by=excluded.created_by
   returning id into gid;
 end if;
 return gid;
end $$;
revoke all on function public.list_class_group_guests(bigint),public.add_class_group_guest(uuid,bigint,text,bigint,bigint,bigint,text) from public,anon;
grant execute on function public.list_class_group_guests(bigint),public.add_class_group_guest(uuid,bigint,text,bigint,bigint,bigint,text) to authenticated;
notify pgrst,'reload schema';
do $$
declare r record; old_sql text; fixed_sql text;
begin
 for r in
  select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in
   ('enrol_after_payment','enrol_in_class_group','schedule_class_group','add_class_group_guest')
 loop
  old_sql:=pg_get_functiondef(r.oid);
  fixed_sql:=replace(old_sql,'and time=p_first_time','and time::time=p_first_time');
  fixed_sql:=regexp_replace(fixed_sql,
   '\m(l|target|lesson|original|other_lesson)\.time\M(?![[:space:]]*::)',
   '\1.time::time','g');
  if fixed_sql<>old_sql then execute fixed_sql;end if;
 end loop;
end $$;
notify pgrst,'reload schema';


commit;
