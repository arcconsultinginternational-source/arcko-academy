-- Arcko Academy Studio · patch v3
-- Run once in Supabase → SQL Editor (New query → paste → Run).
-- Safe to run more than once. Includes every database change made since launch,
-- so it is fine whichever earlier patches you already ran.

-- Lead fields
alter table leads add column if not exists subjects text[] default '{}';
alter table leads add column if not exists note text;
alter table leads add column if not exists source text;
alter table leads add column if not exists priority text default 'Medium';

-- Holidays need a date
alter table extras add column if not exists date date;

-- Trial students: a lead who is booked into a class becomes a student with status 'Trial'.
-- They appear on the class roster, but do not use up package sessions.
alter table students drop constraint if exists students_status_check;
alter table students add constraint students_status_check
  check (status in ('Active', 'Archived', 'Trial'));

create or replace function public.attendance_sync_used() returns trigger
  language plpgsql security definer set search_path = public
  as $$
declare
  delta int := 0;
  sid bigint;
  st text;
  t int;
  u int;
begin
  if tg_op = 'INSERT' then
    sid := new.student_id;
    if new.status = 'Present' then delta := 1; end if;
  elsif tg_op = 'DELETE' then
    sid := old.student_id;
    if old.status = 'Present' then delta := -1; end if;
  else
    if old.lesson_id <> new.lesson_id or old.student_id <> new.student_id then
      raise exception 'Attendance cannot be moved to another lesson or student';
    end if;
    sid := new.student_id;
    if old.status <> 'Present' and new.status = 'Present' then delta := 1;
    elsif old.status = 'Present' and new.status <> 'Present' then delta := -1;
    end if;
  end if;

  if delta <> 0 then
    select status into st from students where id = sid;
    if st = 'Trial' then
      return coalesce(new, old);        -- trial classes are free: no session is used
    end if;
    update students set sessions_used = sessions_used + delta
      where id = sid
      returning total, sessions_used into t, u;
    if delta > 0 and u > t then
      raise exception 'No sessions remaining. Add a package first.';
    end if;
  end if;
  return coalesce(new, old);
end $$;
