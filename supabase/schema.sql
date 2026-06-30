create table if not exists public.tracker_state (
  owner_id text primary key,
  state jsonb not null default '{"walkLog":{},"positions":[],"snapshots":{}}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.tracker_state enable row level security;

comment on table public.tracker_state is 'Single-user tracker state used by the private tracker app.';
comment on column public.tracker_state.owner_id is 'Stable owner id shared by the app deployment.';
comment on column public.tracker_state.state is 'JSON state for walks, portfolio positions, and daily snapshots.';
