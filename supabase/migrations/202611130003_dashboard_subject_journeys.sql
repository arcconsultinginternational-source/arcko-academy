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
commit;
