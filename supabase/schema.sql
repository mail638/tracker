create table if not exists public.tracker_state (
  owner_id text primary key,
  state jsonb not null default '{"training":{},"weeks":{},"wealth":[],"linkedin":[],"sleep":[],"reviews":{},"goals":{}}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.tracker_state enable row level security;

comment on table public.tracker_state is 'Single-user Steuerungs-Tracker state for activity, wealth, sleep, LinkedIn, reviews, and goals.';
comment on column public.tracker_state.owner_id is 'Stable owner id shared by the app deployment.';
comment on column public.tracker_state.state is 'JSON state synchronized by the private tracker app.';
