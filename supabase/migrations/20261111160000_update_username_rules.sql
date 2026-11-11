-- Usernames now allow common social-handle characters and are limited to 3–16 chars.
-- NOT VALID preserves an existing 17-character handle until its owner updates it,
-- while enforcing the new rule for all new and updated rows.
alter table public.profiles
  drop constraint if exists profiles_username_check;

alter table public.profiles
  add constraint profiles_username_check
  check (username ~ '^[A-Za-z0-9._-]{3,16}$') not valid;
