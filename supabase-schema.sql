create table if not exists public.prompt_groups (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  description text not null default '',
  category text not null default '',
  tags text[] not null default '{}',
  use_cases text[] not null default '{}',
  versions jsonb not null default '[]'::jsonb,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.prompt_groups
add column if not exists is_public boolean not null default false;

alter table public.prompt_groups enable row level security;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists prompt_groups_set_updated_at on public.prompt_groups;

create trigger prompt_groups_set_updated_at
before update on public.prompt_groups
for each row
execute function public.set_updated_at();

drop policy if exists "Prompt groups are viewable by owner" on public.prompt_groups;
drop policy if exists "Prompt groups are insertable by owner" on public.prompt_groups;
drop policy if exists "Prompt groups are updatable by owner" on public.prompt_groups;
drop policy if exists "Prompt groups are deletable by owner" on public.prompt_groups;
drop policy if exists "Public or owned prompt groups are viewable" on public.prompt_groups;
drop policy if exists "Prompt groups are insertable by owner only" on public.prompt_groups;
drop policy if exists "Prompt groups are updatable by owner or admin" on public.prompt_groups;
drop policy if exists "Prompt groups are deletable by owner or admin" on public.prompt_groups;
drop policy if exists "Admin users are viewable by self or admin" on public.admin_users;

create policy "Public or owned prompt groups are viewable"
on public.prompt_groups
for select
using (
  is_public = true
  or auth.uid() = owner_id
  or public.is_admin()
);

create policy "Prompt groups are insertable by owner only"
on public.prompt_groups
for insert
to authenticated
with check (auth.uid() = owner_id);

create policy "Prompt groups are updatable by owner or admin"
on public.prompt_groups
for update
to authenticated
using (
  auth.uid() = owner_id
  or public.is_admin()
)
with check (
  auth.uid() = owner_id
  or public.is_admin()
);

create policy "Prompt groups are deletable by owner or admin"
on public.prompt_groups
for delete
to authenticated
using (
  auth.uid() = owner_id
  or public.is_admin()
);

create policy "Admin users are viewable by self or admin"
on public.admin_users
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_admin()
);

-- 관리자 권한 부여 예시:
-- 1) 관리자 이메일의 user id 확인
-- select id, email from auth.users;
-- 2) 관리자 등록
-- insert into public.admin_users (user_id)
-- values ('USER_UUID_HERE')
-- on conflict (user_id) do nothing;
