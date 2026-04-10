create table if not exists public.prompt_groups (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  description text not null default '',
  category text not null default '',
  tags text[] not null default '{}',
  use_cases text[] not null default '{}',
  versions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.prompt_groups enable row level security;

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

create policy "Prompt groups are viewable by owner"
on public.prompt_groups
for select
to authenticated
using (auth.uid() = owner_id);

create policy "Prompt groups are insertable by owner"
on public.prompt_groups
for insert
to authenticated
with check (auth.uid() = owner_id);

create policy "Prompt groups are updatable by owner"
on public.prompt_groups
for update
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "Prompt groups are deletable by owner"
on public.prompt_groups
for delete
to authenticated
using (auth.uid() = owner_id);
