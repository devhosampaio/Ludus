-- Enables nested replies and likes on individual review comments.
alter table public.review_comments
  add column parent_comment_id uuid;

alter table public.review_comments
  add constraint review_comments_id_review_id_key unique (id, review_id);

alter table public.review_comments
  add constraint review_comments_parent_same_review_fkey
  foreign key (parent_comment_id, review_id)
  references public.review_comments (id, review_id)
  on delete cascade;

create index review_comments_parent_comment_id_idx
  on public.review_comments (parent_comment_id);

create table public.review_comment_likes (
  comment_id uuid not null references public.review_comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.review_comment_likes enable row level security;

create policy "Comment likes are publicly readable"
  on public.review_comment_likes for select
  to anon, authenticated using (true);

create policy "Users can like comments"
  on public.review_comment_likes for insert
  to authenticated with check ((select auth.uid()) = user_id);

create policy "Users can remove their comment likes"
  on public.review_comment_likes for delete
  to authenticated using ((select auth.uid()) = user_id);

grant select on public.review_comment_likes to anon, authenticated;
grant insert, delete on public.review_comment_likes to authenticated;
