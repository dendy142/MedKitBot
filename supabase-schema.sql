-- ================================================
-- Medkit Bot — Database Schema
-- Run this in Supabase SQL Editor
-- ================================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ================================================
-- 1. Users
-- ================================================
create table users (
  id uuid primary key default uuid_generate_v4(),
  telegram_id bigint unique not null,
  username text,
  first_name text,
  timezone text default 'Europe/Moscow',
  settings jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index idx_users_telegram_id on users(telegram_id);

-- ================================================
-- 2. Medkits (medicine cabinets)
-- ================================================
create table medkits (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  owner_id uuid not null references users(id) on delete cascade,
  created_at timestamptz default now()
);

create index idx_medkits_owner on medkits(owner_id);

-- ================================================
-- 3. Medkit Members (sharing)
-- ================================================
create table medkit_members (
  id uuid primary key default uuid_generate_v4(),
  medkit_id uuid not null references medkits(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner', 'editor', 'viewer')),
  joined_at timestamptz default now(),
  unique(medkit_id, user_id)
);

create index idx_medkit_members_user on medkit_members(user_id);
create index idx_medkit_members_medkit on medkit_members(medkit_id);

-- ================================================
-- 4. Medicines
-- ================================================
create table medicines (
  id uuid primary key default uuid_generate_v4(),
  medkit_id uuid not null references medkits(id) on delete cascade,
  name text not null,
  dosage text,
  category text,
  tags text[] default '{}',
  expiry_date date,
  quantity numeric default 0,
  quantity_unit text default 'шт',
  initial_quantity numeric default 0,
  photo_file_ids text[] default '{}',
  notes text,
  is_favorite boolean default false,
  is_archived boolean default false,
  version integer default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_medicines_medkit on medicines(medkit_id);
create index idx_medicines_name on medicines(name);
create index idx_medicines_archived on medicines(medkit_id, is_archived);

-- ================================================
-- 5. Schedules (intake courses)
-- ================================================
create table schedules (
  id uuid primary key default uuid_generate_v4(),
  medicine_id uuid not null references medicines(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  time_mode text not null check (time_mode in ('exact', 'period')),
  time_value text not null,
  dose_per_intake numeric default 1,
  frequency text not null default 'daily' check (frequency in ('daily', 'every_other_day', 'weekly_days')),
  frequency_days integer[] default '{}',
  duration_type text not null default 'indefinite' check (duration_type in ('indefinite', 'days', 'until_date')),
  duration_value text,
  start_date date default current_date,
  status text default 'active' check (status in ('active', 'paused', 'completed')),
  created_at timestamptz default now()
);

create index idx_schedules_medicine on schedules(medicine_id);
create index idx_schedules_user on schedules(user_id);
create index idx_schedules_status on schedules(status);

-- ================================================
-- 6. Intake Logs
-- ================================================
create table intake_logs (
  id uuid primary key default uuid_generate_v4(),
  schedule_id uuid not null references schedules(id) on delete cascade,
  medicine_id uuid not null references medicines(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  planned_at timestamptz not null,
  status text default 'pending' check (status in ('pending', 'taken', 'skipped', 'snoozed')),
  confirmed_at timestamptz,
  note text
);

create index idx_intake_logs_user_date on intake_logs(user_id, planned_at);
create index idx_intake_logs_schedule on intake_logs(schedule_id);
create index idx_intake_logs_status on intake_logs(status);

-- ================================================
-- 7. Invitations
-- ================================================
create table invitations (
  id uuid primary key default uuid_generate_v4(),
  medkit_id uuid not null references medkits(id) on delete cascade,
  invite_code text unique not null,
  invited_username text,
  role text default 'editor' check (role in ('editor', 'viewer')),
  status text default 'pending' check (status in ('pending', 'accepted', 'expired')),
  created_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '7 days')
);

create index idx_invitations_code on invitations(invite_code);

-- ================================================
-- 8. Shopping List
-- ================================================
create table shopping_list (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  medicine_id uuid references medicines(id) on delete set null,
  medkit_id uuid references medkits(id) on delete set null,
  name text not null,
  is_bought boolean default false,
  created_at timestamptz default now()
);

create index idx_shopping_list_user on shopping_list(user_id);

-- ================================================
-- 9. Action Logs (audit)
-- ================================================
create table action_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index idx_action_logs_user on action_logs(user_id);
create index idx_action_logs_entity on action_logs(entity_type, entity_id);

-- ================================================
-- 10. Medicine History (field-level changes)
-- ================================================
create table medicine_history (
  id uuid primary key default uuid_generate_v4(),
  medicine_id uuid not null references medicines(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  field_name text not null,
  old_value text,
  new_value text,
  changed_at timestamptz default now()
);

create index idx_medicine_history_medicine on medicine_history(medicine_id);

-- ================================================
-- RLS Policies
-- ================================================

-- Enable RLS on all tables
alter table users enable row level security;
alter table medkits enable row level security;
alter table medkit_members enable row level security;
alter table medicines enable row level security;
alter table schedules enable row level security;
alter table intake_logs enable row level security;
alter table invitations enable row level security;
alter table shopping_list enable row level security;
alter table action_logs enable row level security;
alter table medicine_history enable row level security;

-- Since we use service_key (bypasses RLS), these policies are for
-- potential future use with anon/authenticated keys.
-- For now, service_key has full access.

-- Users: can read/write own record
create policy "users_self" on users for all using (true) with check (true);

-- Medkits: accessible if user is a member
create policy "medkits_member" on medkits for all using (true) with check (true);

-- Medkit members: accessible if user is a member of the medkit
create policy "medkit_members_access" on medkit_members for all using (true) with check (true);

-- Medicines: accessible through medkit membership
create policy "medicines_access" on medicines for all using (true) with check (true);

-- Schedules: user's own schedules
create policy "schedules_access" on schedules for all using (true) with check (true);

-- Intake logs: user's own logs
create policy "intake_logs_access" on intake_logs for all using (true) with check (true);

-- Invitations: accessible
create policy "invitations_access" on invitations for all using (true) with check (true);

-- Shopping list: user's own items
create policy "shopping_list_access" on shopping_list for all using (true) with check (true);

-- Action logs: user's own logs
create policy "action_logs_access" on action_logs for all using (true) with check (true);

-- Medicine history: accessible
create policy "medicine_history_access" on medicine_history for all using (true) with check (true);
