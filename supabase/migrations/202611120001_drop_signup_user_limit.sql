-- Remove the baseline account cap. In production it was attached by hand to auth.users
-- (restrict_signup) and stopped new registrations at 150 accounts: each employee uses two
-- (the contact address that receives the code, and the login account), so about 75 people.
-- CASCADE drops every trigger that calls it, whatever it was named; nothing else depends on it.
begin;

drop function if exists public.check_user_limit() cascade;

commit;
