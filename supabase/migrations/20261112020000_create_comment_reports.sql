create table if not exists public.comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.review_comments(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('spam','harassment','spoiler','inappropriate','other')),
  details text not null default '' check (char_length(details) <= 1000),
  created_at timestamptz not null default now(),
  constraint comment_reports_comment_reporter_key unique (comment_id, reporter_id)
);

alter table public.comment_reports enable row level security;

create policy "Users can submit own comment reports"
  on public.comment_reports for insert to authenticated
  with check ((select auth.uid()) = reporter_id);

create policy "Users can read own comment reports"
  on public.comment_reports for select to authenticated
  using ((select auth.uid()) = reporter_id);

grant select, insert on public.comment_reports to authenticated;
