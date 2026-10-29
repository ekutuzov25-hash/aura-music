-- ─── AURA Premium promo codes ───
-- Run once in Supabase → SQL Editor (after schema.sql).
-- Codes themselves are inserted separately and never committed to git.

-- promo codes can grant a lifetime subscription
alter table public.subscriptions drop constraint if exists subscriptions_plan_check;
alter table public.subscriptions add constraint subscriptions_plan_check
  check (plan in ('month', 'half_year', 'year', 'lifetime'));

create table if not exists public.promo_codes (
  code text primary key check (code ~ '^AURA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  plan text not null check (plan in ('month', 'half_year', 'year', 'lifetime')),
  created_at timestamptz not null default now(),
  redeemed_by uuid references auth.users on delete set null,
  redeemed_at timestamptz
);
-- RLS on and NO policies: nobody can read or list codes through the API.
-- The only way in is redeem_promo() below.
alter table public.promo_codes enable row level security;

-- Redeem a code for the signed-in user. One code = one account, forever:
-- the row is locked, checked and marked used in the same transaction.
create or replace function public.redeem_promo(p_code text)
returns table (sub_plan text, sub_end timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c public.promo_codes%rowtype;
  cur public.subscriptions%rowtype;
  base timestamptz;
  new_end timestamptz;
  new_plan text;
begin
  if uid is null then
    raise exception 'not_signed_in';
  end if;

  select * into c from public.promo_codes where code = upper(btrim(p_code)) for update;
  if c.code is null then
    raise exception 'invalid_code';
  end if;
  if c.redeemed_by is not null then
    raise exception 'already_used';
  end if;

  select * into cur from public.subscriptions where user_id = uid for update;
  if cur.user_id is not null and cur.plan = 'lifetime' and cur.status = 'active' then
    raise exception 'already_lifetime';
  end if;

  if c.plan = 'lifetime' then
    new_plan := 'lifetime';
    new_end := '9999-12-31 00:00:00+00';
  else
    new_plan := c.plan;
    -- stack on top of time that is still left
    base := greatest(now(), coalesce(case when cur.status = 'active' then cur.current_period_end end, now()));
    new_end := base + case c.plan when 'month' then interval '1 month'
                                  when 'half_year' then interval '6 months'
                                  else interval '1 year' end;
  end if;

  insert into public.subscriptions (user_id, plan, status, current_period_end, updated_at)
  values (uid, new_plan, 'active', new_end, now())
  on conflict (user_id) do update
    set plan = excluded.plan, status = 'active', current_period_end = excluded.current_period_end, updated_at = now();

  update public.promo_codes set redeemed_by = uid, redeemed_at = now() where code = c.code;
  return query select new_plan, new_end;
end;
$$;
revoke all on function public.redeem_promo(text) from public, anon;
grant execute on function public.redeem_promo(text) to authenticated;
