-- Arcko Academy Studio · v2 patch
-- Run in Supabase SQL Editor after schema.sql has already been applied.
-- Safe to run multiple times.

alter table leads add column if not exists subjects text[] default '{}';
alter table leads add column if not exists note text;
alter table extras add column if not exists date date;
