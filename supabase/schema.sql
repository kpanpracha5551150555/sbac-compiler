-- SBAC Compiler — Phase 3: accounts + cloud storage (Supabase)
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Safe to run again (idempotent).

-- ---------- projects: each user's saved work ----------
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  dialect     text not null default 'tsql' check (dialect in ('tsql', 'mssql', 'mysql', 'sqlite')),
  files       jsonb not null default '[]'::jsonb
              check (jsonb_typeof(files) = 'array' and pg_column_size(files) < 1000000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists projects_user_updated on public.projects (user_id, updated_at desc);

-- ---------- progress: lessons / exercises (one row per user) ----------
create table if not exists public.progress (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data        jsonb not null default '{}'::jsonb check (pg_column_size(data) < 1000000),
  updated_at  timestamptz not null default now()
);

-- ---------- keep updated_at fresh ----------
create or replace function public.sbac_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.sbac_touch();
drop trigger if exists progress_touch on public.progress;
create trigger progress_touch before update on public.progress
  for each row execute function public.sbac_touch();

-- ---------- Row Level Security: everyone sees only their own rows ----------
alter table public.projects enable row level security;
alter table public.progress enable row level security;

drop policy if exists "projects: select own" on public.projects;
drop policy if exists "projects: insert own" on public.projects;
drop policy if exists "projects: update own" on public.projects;
drop policy if exists "projects: delete own" on public.projects;
create policy "projects: select own" on public.projects for select to authenticated using (user_id = auth.uid());
create policy "projects: insert own" on public.projects for insert to authenticated with check (user_id = auth.uid());
create policy "projects: update own" on public.projects for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "projects: delete own" on public.projects for delete to authenticated using (user_id = auth.uid());

drop policy if exists "progress: select own" on public.progress;
drop policy if exists "progress: insert own" on public.progress;
drop policy if exists "progress: update own" on public.progress;
create policy "progress: select own" on public.progress for select to authenticated using (user_id = auth.uid());
create policy "progress: insert own" on public.progress for insert to authenticated with check (user_id = auth.uid());
create policy "progress: update own" on public.progress for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- limit: at most 200 projects per user
create or replace function public.sbac_project_quota() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.projects where user_id = new.user_id) >= 200 then
    raise exception 'project limit reached (200)';
  end if;
  return new;
end $$;
drop trigger if exists projects_quota on public.projects;
create trigger projects_quota before insert on public.projects
  for each row execute function public.sbac_project_quota();
