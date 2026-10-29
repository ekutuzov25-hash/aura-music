-- AURA database schema for Supabase.
-- Run once: Supabase Dashboard → SQL Editor → paste → Run.
-- Row Level Security makes sure every user can only touch their own data,
-- even though the browser uses the public anon key.

-- ─── Profiles ───
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique check (username is null or username ~ '^[a-z0-9_.]{3,24}$'),
  display_name text,
  bio text default '' check (char_length(bio) <= 300),
  avatar_url text,
  is_private boolean not null default true,
  show_history boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "profiles: read own or public" on public.profiles
  for select using (auth.uid() = id or is_private = false);
create policy "profiles: insert own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ─── Playlists ───
create table if not exists public.playlists (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  cover text,
  is_public boolean not null default false,
  -- array of { track: {...metadata}, addedAt } — metadata is kept even if a
  -- source later removes the track, so playlists never silently lose items
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists playlists_owner_idx on public.playlists (owner_id);
alter table public.playlists enable row level security;

create policy "playlists: read own or public" on public.playlists
  for select using (auth.uid() = owner_id or is_public = true);
create policy "playlists: insert own" on public.playlists
  for insert with check (auth.uid() = owner_id);
create policy "playlists: update own" on public.playlists
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "playlists: delete own" on public.playlists
  for delete using (auth.uid() = owner_id);

-- ─── Likes, saved artists/albums, history, preferences ───
create table if not exists public.user_library (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_library enable row level security;

create policy "library: all own" on public.user_library
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─── Registration: login (username) is created together with the account ───
-- The browser passes { username, display_name } as sign-up metadata; this
-- trigger creates the profile row. A taken username makes sign-up fail.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    nullif(lower(new.raw_user_meta_data ->> 'username'), ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Lets the sign-up form check a login before submitting (returns only true/false).
create or replace function public.username_available(name text)
returns boolean language sql security definer set search_path = public stable as $$
  select not exists (select 1 from public.profiles where username = lower(name));
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- ─── Subscriptions (AURA Premium) ───
-- Written ONLY by the server (service role) after the payment provider
-- confirms a payment. Users can read their own row but never change it.
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users on delete cascade,
  plan text not null check (plan in ('month', 'half_year', 'year')),
  status text not null default 'active' check (status in ('active', 'expired', 'canceled')),
  current_period_end timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
create policy "subscriptions: read own" on public.subscriptions
  for select using (auth.uid() = user_id);

create table if not exists public.payments (
  id uuid primary key,                       -- our order id
  provider_id text unique,                   -- YooKassa payment id
  user_id uuid not null references auth.users on delete cascade,
  plan text not null,
  amount numeric(10, 2) not null,
  currency text not null default 'RUB',
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payments_user_idx on public.payments (user_id);
alter table public.payments enable row level security;
create policy "payments: read own" on public.payments
  for select using (auth.uid() = user_id);
