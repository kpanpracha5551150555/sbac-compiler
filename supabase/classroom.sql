-- SBAC Compiler — Phase 4: classroom mode
-- Run once in Supabase → SQL Editor (after schema.sql). Safe to run again.

-- ---------- tables ----------
create table if not exists public.classes (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  join_code   text not null unique check (join_code ~ '^[A-Z0-9]{6}$'),
  created_at  timestamptz not null default now()
);

create table if not exists public.class_members (
  class_id      uuid not null references public.classes (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          text not null default 'student' check (role in ('teacher', 'student')),
  display_name  text not null default '' check (char_length(display_name) <= 80),
  joined_at     timestamptz not null default now(),
  primary key (class_id, user_id)
);
create index if not exists class_members_user on public.class_members (user_id);

create table if not exists public.assignments (
  id             uuid primary key default gen_random_uuid(),
  class_id       uuid not null references public.classes (id) on delete cascade,
  title          text not null check (char_length(title) between 1 and 160),
  description    text not null default '' check (char_length(description) <= 5000),
  items          jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and pg_column_size(items) < 500000),
  due_at         timestamptz,
  published      boolean not null default true,
  show_expected  boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists assignments_class on public.assignments (class_id, created_at);

-- answer keys of teacher-written problems: only the teacher can read them
create table if not exists public.assignment_keys (
  assignment_id  uuid primary key references public.assignments (id) on delete cascade,
  solutions      jsonb not null default '{}'::jsonb check (pg_column_size(solutions) < 500000)
);

create table if not exists public.submissions (
  assignment_id  uuid not null references public.assignments (id) on delete cascade,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_key       text not null check (char_length(item_key) <= 40),
  code           text not null default '' check (char_length(code) <= 50000),
  passed         boolean not null default false,
  submitted_at   timestamptz not null default now(),
  primary key (assignment_id, user_id, item_key)
);

drop trigger if exists assignments_touch on public.assignments;
create trigger assignments_touch before update on public.assignments
  for each row execute function public.sbac_touch();

-- ---------- helper functions (security definer → no RLS recursion) ----------
create or replace function public.sbac_is_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from class_members where class_id = cid and user_id = auth.uid());
$$;
create or replace function public.sbac_is_teacher(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from classes where id = cid and owner_id = auth.uid());
$$;
create or replace function public.sbac_assignment_class(aid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select class_id from assignments where id = aid;
$$;
create or replace function public.sbac_can_see_assignment(aid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from assignments a
    where a.id = aid
      and (public.sbac_is_teacher(a.class_id) or (a.published and public.sbac_is_member(a.class_id)))
  );
$$;

-- the class owner becomes a member (role teacher) automatically
create or replace function public.sbac_class_owner_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into class_members (class_id, user_id, role) values (new.id, new.owner_id, 'teacher')
  on conflict (class_id, user_id) do nothing;
  return new;
end $$;
drop trigger if exists classes_owner_member on public.classes;
create trigger classes_owner_member after insert on public.classes
  for each row execute function public.sbac_class_owner_member();

-- students join with the 6-character code
create or replace function public.join_class(p_code text, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if char_length(trim(coalesce(p_name, ''))) = 0 then raise exception 'display name required'; end if;
  select id into cid from classes where join_code = upper(trim(p_code));
  if cid is null then raise exception 'class not found'; end if;
  insert into class_members (class_id, user_id, role, display_name)
  values (cid, auth.uid(), 'student', left(trim(p_name), 80))
  on conflict (class_id, user_id) do update set display_name = excluded.display_name
  where class_members.role = 'student';
  return cid;
end $$;

-- at most 50 classes per teacher
create or replace function public.sbac_class_quota() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from classes where owner_id = new.owner_id) >= 50 then
    raise exception 'class limit reached (50)';
  end if;
  return new;
end $$;
drop trigger if exists classes_quota on public.classes;
create trigger classes_quota before insert on public.classes
  for each row execute function public.sbac_class_quota();

revoke all on function public.join_class(text, text) from public, anon;
grant execute on function public.join_class(text, text) to authenticated;
grant execute on function public.sbac_is_member(uuid), public.sbac_is_teacher(uuid),
  public.sbac_assignment_class(uuid), public.sbac_can_see_assignment(uuid) to authenticated;

-- ---------- privileges (rows are limited by RLS below) ----------
revoke all on public.classes, public.class_members, public.assignments, public.assignment_keys, public.submissions from anon;
grant select, insert, update, delete on public.classes to authenticated;
grant select, delete on public.class_members to authenticated;
grant update (display_name) on public.class_members to authenticated;
grant select, insert, update, delete on public.assignments to authenticated;
grant select, insert, update, delete on public.assignment_keys to authenticated;
grant select, insert, update on public.submissions to authenticated;

-- ---------- Row Level Security ----------
alter table public.classes enable row level security;
alter table public.class_members enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_keys enable row level security;
alter table public.submissions enable row level security;

drop policy if exists "classes: select" on public.classes;
drop policy if exists "classes: insert" on public.classes;
drop policy if exists "classes: update" on public.classes;
drop policy if exists "classes: delete" on public.classes;
create policy "classes: select" on public.classes for select to authenticated using (owner_id = auth.uid() or public.sbac_is_member(id));
create policy "classes: insert" on public.classes for insert to authenticated with check (owner_id = auth.uid());
create policy "classes: update" on public.classes for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "classes: delete" on public.classes for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "members: select" on public.class_members;
drop policy if exists "members: update own name" on public.class_members;
drop policy if exists "members: delete" on public.class_members;
create policy "members: select" on public.class_members for select to authenticated using (user_id = auth.uid() or public.sbac_is_teacher(class_id));
create policy "members: update own name" on public.class_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "members: delete" on public.class_members for delete to authenticated using ((user_id = auth.uid() and role = 'student') or (public.sbac_is_teacher(class_id) and role = 'student'));

drop policy if exists "assignments: select" on public.assignments;
drop policy if exists "assignments: write" on public.assignments;
create policy "assignments: select" on public.assignments for select to authenticated using (public.sbac_is_teacher(class_id) or (published and public.sbac_is_member(class_id)));
create policy "assignments: write" on public.assignments for all to authenticated using (public.sbac_is_teacher(class_id)) with check (public.sbac_is_teacher(class_id));

drop policy if exists "keys: teacher only" on public.assignment_keys;
create policy "keys: teacher only" on public.assignment_keys for all to authenticated
  using (public.sbac_is_teacher(public.sbac_assignment_class(assignment_id)))
  with check (public.sbac_is_teacher(public.sbac_assignment_class(assignment_id)));

drop policy if exists "submissions: select" on public.submissions;
drop policy if exists "submissions: insert own" on public.submissions;
drop policy if exists "submissions: update own" on public.submissions;
create policy "submissions: select" on public.submissions for select to authenticated
  using (user_id = auth.uid() or public.sbac_is_teacher(public.sbac_assignment_class(assignment_id)));
create policy "submissions: insert own" on public.submissions for insert to authenticated
  with check (user_id = auth.uid() and public.sbac_can_see_assignment(assignment_id));
create policy "submissions: update own" on public.submissions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.sbac_can_see_assignment(assignment_id));

notify pgrst, 'reload schema';
