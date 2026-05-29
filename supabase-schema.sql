create extension if not exists pgcrypto;

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  course text not null,
  score integer not null check (score between 1 and 250),
  played_on date not null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rounds enable row level security;

drop policy if exists "Rounds are visible to everyone" on public.rounds;
drop policy if exists "Anyone can add rounds" on public.rounds;
drop policy if exists "Anyone can update rounds" on public.rounds;
drop policy if exists "Anyone can delete rounds" on public.rounds;

create policy "Rounds are visible to everyone"
on public.rounds
for select
to anon
using (true);

create policy "Anyone can add rounds"
on public.rounds
for insert
to anon
with check (true);

create policy "Anyone can update rounds"
on public.rounds
for update
to anon
using (true)
with check (true);

create policy "Anyone can delete rounds"
on public.rounds
for delete
to anon
using (true);
