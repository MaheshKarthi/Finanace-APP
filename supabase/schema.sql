-- Run this entire file in your Supabase project → SQL Editor → Run

-- ── sync_data ────────────────────────────────────────────────────────────────
-- Stores each Dexie table as a JSON blob per user.
create table if not exists public.sync_data (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  table_name  text        not null,
  records     jsonb       not null default '[]',
  updated_at  timestamptz not null default now(),
  primary key (user_id, table_name)
);
alter table public.sync_data enable row level security;
create policy "sync_data: own rows only" on public.sync_data
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── pending_sms ──────────────────────────────────────────────────────────────
-- Forwarded SMS rows.  Edge Function writes here; PWA reads + confirms.
create table if not exists public.pending_sms (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        references auth.users(id) on delete cascade,
  raw_sms     text        not null,
  sender      text,
  sms_time    timestamptz,
  parsed      jsonb,
  -- user_action: null=pending | 'confirmed' | 'dismissed'
  user_action text,
  processed   boolean     not null default false,
  created_at  timestamptz not null default now()
);
alter table public.pending_sms enable row level security;
create policy "pending_sms: own rows only" on public.pending_sms
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── webhook_tokens ───────────────────────────────────────────────────────────
-- One secret token per user — pasted into SMS Forwarder app URL.
create table if not exists public.webhook_tokens (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  token    text not null default encode(gen_random_bytes(24), 'hex')
);
alter table public.webhook_tokens enable row level security;
create policy "webhook_tokens: own row only" on public.webhook_tokens
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── push_subscriptions ───────────────────────────────────────────────────────
-- Web Push subscription per user (one per browser/device).
-- Edge Function reads this to send push notifications.
create table if not exists public.push_subscriptions (
  user_id      uuid        primary key references auth.users(id) on delete cascade,
  subscription jsonb       not null,
  updated_at   timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy "push_subscriptions: own row only" on public.push_subscriptions
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Auto-create webhook token on signup ──────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.webhook_tokens (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
