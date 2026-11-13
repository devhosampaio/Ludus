create table public.review_saves (
  user_id uuid not null references public.profiles(id) on delete cascade,
  review_id uuid not null references public.reviews(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, review_id)
);

create index review_saves_review_id_idx on public.review_saves (review_id);

alter table public.review_saves enable row level security;

create policy "Users can read their own saved reviews"
on public.review_saves for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can save reviews to their own list"
on public.review_saves for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can remove reviews from their own list"
on public.review_saves for delete
to authenticated
using (auth.uid() = user_id);

grant select, insert, delete on public.review_saves to authenticated;

create or replace function public.get_review_save_counts(p_review_ids uuid[])
returns table (review_id uuid, save_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select saved.review_id, count(*)::bigint
  from public.review_saves as saved
  where auth.uid() is not null
    and saved.review_id = any(p_review_ids)
  group by saved.review_id;
$$;

revoke all on function public.get_review_save_counts(uuid[]) from public, anon;
grant execute on function public.get_review_save_counts(uuid[]) to authenticated;
