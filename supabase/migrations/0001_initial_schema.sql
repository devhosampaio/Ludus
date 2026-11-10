-- Ludus · Initial database schema
-- Run once in the Supabase SQL Editor for a fresh project.

create extension if not exists pgcrypto;

create type public.review_status as enum ('playing', 'completed', 'abandoned');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-zA-Z0-9_]{3,24}$'),
  display_name text not null default '',
  bio text not null default '' check (char_length(bio) <= 280),
  avatar_url text,
  banner_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  steamgriddb_id bigint unique,
  slug text not null unique,
  title text not null,
  cover_url text,
  hero_url text,
  release_year integer check (release_year is null or release_year between 1950 and 2100),
  developer text,
  description text,
  platforms text[] not null default '{}',
  genres text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  body text not null default '' check (char_length(body) <= 5000),
  status public.review_status,
  liked_game boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, game_id)
);

create table public.review_likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  review_id uuid not null references public.reviews(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, review_id)
);

create table public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self_follow check (follower_id <> following_id)
);

create table public.review_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  review_id uuid not null references public.reviews(id) on delete cascade,
  reason text not null check (reason in ('spam', 'harassment', 'spoiler', 'inappropriate', 'other')),
  details text not null default '' check (char_length(details) <= 1000),
  created_at timestamptz not null default now(),
  unique (reporter_id, review_id)
);

create index reviews_created_at_idx on public.reviews (created_at desc);
create index reviews_game_id_idx on public.reviews (game_id);
create index reviews_user_id_idx on public.reviews (user_id);
create index review_likes_review_id_idx on public.review_likes (review_id);
create index follows_following_id_idx on public.follows (following_id);
create index games_title_search_idx on public.games using gin (to_tsvector('simple', title));

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger games_set_updated_at
before update on public.games
for each row execute function public.set_updated_at();

create trigger reviews_set_updated_at
before update on public.reviews
for each row execute function public.set_updated_at();

-- Create a public profile automatically whenever a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
begin
  requested_username := coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    'user_' || replace(left(new.id::text, 8), '-', '')
  );

  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    requested_username,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), '')
  );

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Enable Row Level Security on every exposed table.
alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.reviews enable row level security;
alter table public.review_likes enable row level security;
alter table public.follows enable row level security;
alter table public.review_reports enable row level security;

-- Profiles: public read; users may update only their own profile.
create policy "Profiles are publicly readable"
on public.profiles for select
to anon, authenticated
using (true);

create policy "Users can update their own profile"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- Games are publicly readable. Catalog writes will be performed by trusted server functions.
create policy "Games are publicly readable"
on public.games for select
to anon, authenticated
using (true);

-- Reviews are public; only their author can create, edit, or delete them.
create policy "Reviews are publicly readable"
on public.reviews for select
to anon, authenticated
using (true);

create policy "Users can create their own reviews"
on public.reviews for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own reviews"
on public.reviews for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own reviews"
on public.reviews for delete
to authenticated
using (auth.uid() = user_id);

-- Review likes are public; users control only their own likes.
create policy "Review likes are publicly readable"
on public.review_likes for select
to anon, authenticated
using (true);

create policy "Users can like reviews"
on public.review_likes for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can remove their own likes"
on public.review_likes for delete
to authenticated
using (auth.uid() = user_id);

-- Follows are public; users control only relationships they initiate.
create policy "Follows are publicly readable"
on public.follows for select
to anon, authenticated
using (true);

create policy "Users can follow from their own account"
on public.follows for insert
to authenticated
with check (auth.uid() = follower_id);

create policy "Users can unfollow from their own account"
on public.follows for delete
to authenticated
using (auth.uid() = follower_id);

-- Reports can be submitted by signed-in users; reporters can see their own reports.
create policy "Users can submit review reports"
on public.review_reports for insert
to authenticated
with check (auth.uid() = reporter_id);

create policy "Users can read their own reports"
on public.review_reports for select
to authenticated
using (auth.uid() = reporter_id);

grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.games, public.reviews, public.review_likes, public.follows to anon, authenticated;
grant insert, update, delete on public.reviews to authenticated;
grant update on public.profiles to authenticated;
grant insert, select, delete on public.review_likes, public.follows to authenticated;
grant insert, select on public.review_reports to authenticated;
