-- Run AFTER schema.sql, and AFTER you have created the users in
-- Supabase → Authentication → Users → "Add user" (tick "Auto Confirm User").
-- For each user, click them and copy "User UID", then replace the placeholders below.

insert into branches (name, email) values ('Sathorn', 'arckocreative@gmail.com');

insert into profiles (id, full_name, role)
values ('PASTE-OWNER-UID', 'Anies', 'owner');

insert into profiles (id, full_name, role, branch_id) values
  ('PASTE-MANAGER-UID', 'Test Manager', 'manager', (select id from branches where name = 'Sathorn')),
  ('PASTE-ADMIN-UID',   'Test Admin',   'admin',   (select id from branches where name = 'Sathorn')),
  ('PASTE-TEACHER-UID', 'Test Teacher', 'teacher', (select id from branches where name = 'Sathorn'));


-- ---------------------------------------------------------------
-- ONBOARDING A NEW FRANCHISEE (later): create their login in Authentication → Users, then
--   insert into branches (name) values ('Franchisee branch name');
--   insert into profiles (id, full_name, role, branch_id)
--   values ('THEIR-UID', 'Their name', 'manager', (select id from branches where name = 'Franchisee branch name'));
-- They then add their own students, and you add their teachers and admin the same way.
-- RESET A PASSWORD: Authentication → Users → the user → "Send password recovery" or set a new password.
-- REMOVE SOMEONE'S ACCESS: Authentication → Users → delete the user (their profile is removed automatically;
-- lessons they taught become "Unassigned").
