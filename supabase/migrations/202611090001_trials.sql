alter table public.lessons add column if not exists trial_guests jsonb not null default '[]'::jsonb;
