-- APPLY ONLY AFTER every installed app is newer than 0.9.8 and the notify-sheet Edge
-- Function is deployed and has sent a test mail. App versions up to 0.9.8 stop working
-- with this.
--
-- The newer app reads a sheet through get_sheet, saves the common evaluation through
-- save_common_evaluation and sends mail through the Edge Function, so what 0.9.8 needed is
-- taken away:
--   * the SMTP account, password included, and the recipients' addresses are no longer
--     handed to any client;
--   * the evaluations cannot be read from the tables any more. Row policies say who is on a
--     sheet but cannot hide one column from one reader (a primary evaluator could read the
--     secondary evaluation, the subject the comments, by calling the API directly). Clients
--     keep the columns they need to list sheets and to find and write rows; everything else
--     comes from get_sheet, which shows each reader their part;
--   * the common evaluation is no longer written to its table directly.
-- Requires 202610120003.
begin;

drop function if exists public.get_notification_smtp_settings();
drop function if exists public.get_submitted_sheet_notification_recipient(bigint);
drop function if exists public.get_first_evaluated_sheet_notification_recipient(bigint);
drop function if exists public.get_finalized_sheet_notification_recipients(bigint);

-- Lists of sheets, and the keys that updates and "insert ... on conflict" address rows by.
revoke select on public.evaluation_sheets from authenticated;
grant select (
  id, period_id, employee_id, status, total_score, created_at, updated_at, grade_id,
  primary_evaluator_id, secondary_evaluator_id, no_secondary_evaluator
) on public.evaluation_sheets to authenticated;
-- Everyone who can see a goal sees its text and first score; only second_score depends on
-- the reader. ("on conflict do update" needs select on the columns it writes.)
revoke select on public.milestones from authenticated;
grant select (id, sheet_id, goal_number, challenge_goal, midterm_goal, achievement, first_score)
  on public.milestones to authenticated;
-- Read through get_sheet and written through save_common_evaluation.
revoke all on public.common_evaluation_results from authenticated;

commit;
