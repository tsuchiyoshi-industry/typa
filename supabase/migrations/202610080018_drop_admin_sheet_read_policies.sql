-- An Admin reads other people's sheets only through get_sheet_overview (the roster and its
-- PDF, with ranks and overall comments). The app no longer opens such a sheet itself, so the
-- row policies that 202610080016 added for that are removed again.
begin;

drop policy if exists "Admin reads every evaluation sheet" on public.evaluation_sheets;
drop policy if exists "Admin reads every milestone" on public.milestones;
drop policy if exists "Admin reads every common evaluation result" on public.common_evaluation_results;

commit;
