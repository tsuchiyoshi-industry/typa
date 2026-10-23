-- アプリ内通知: 次に評価する人への依頼を、状態の変更と同じトランザクションで残す。
-- 送信の失敗や再送がないので、提出・確定と通知の食い違いが起きない。
-- Apply after 202610230002.
begin;

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  recipient_employee_id integer not null references public.employees(id) on delete cascade,
  sheet_id bigint not null references public.evaluation_sheets(id) on delete cascade,
  kind text not null check (kind in ('submitted', 'first_evaluated')),
  -- 知らせた時点の表示名。後で評価者が替わってシートを読めなくなっても、通知は読める
  employee_name text not null,
  period_name text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_recipient_idx
  on public.notifications (recipient_employee_id, created_at desc);

-- 読めるのは宛先の本人だけ。作るのは状態の変更(トリガー)だけ
alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon, authenticated;
grant select on public.notifications to authenticated;
drop policy if exists "recipients read their notifications" on public.notifications;
create policy "recipients read their notifications"
  on public.notifications for select to authenticated
  using (recipient_employee_id = public.current_employee_id());
-- 本人が変えられるのは、既読・未読だけ
grant update (read_at) on public.notifications to authenticated;
drop policy if exists "recipients mark their notifications" on public.notifications;
create policy "recipients mark their notifications"
  on public.notifications for update to authenticated
  using (recipient_employee_id = public.current_employee_id())
  with check (recipient_employee_id = public.current_employee_id());

-- 次に評価する人。提出は一次評価者、一次評価の確定は二次評価者(「なし」なら一次評価者が最終確定する)
create or replace function public.next_evaluator_of(sheet public.evaluation_sheets)
returns integer language sql immutable set search_path = '' as $$
  select case sheet.status
    when 'submitted' then sheet.primary_evaluator_id
    when 'first_evaluated' then coalesce(
      sheet.secondary_evaluator_id,
      case when sheet.no_secondary_evaluator then sheet.primary_evaluator_id end)
  end
$$;
revoke all on function public.next_evaluator_of(public.evaluation_sheets) from public, anon, authenticated;

create or replace function public.notify_next_evaluator()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  recipient integer := public.next_evaluator_of(new);
begin
  if old.status = new.status then
    -- 評価者が替わった(異動など): 待っている依頼は取り下げ、新しく頼む人に頼み直す
    if recipient is not distinct from public.next_evaluator_of(old) then
      return null;
    end if;
    delete from public.notifications
    where sheet_id = new.id and kind = new.status and read_at is null;
  elsif new.status = 'draft' then
    -- 本人が下書きに戻した: 頼んだことは取り下げられた
    delete from public.notifications
    where sheet_id = new.id and kind = old.status and read_at is null;
  else
    -- 前の状態で頼んだことは済んだので、既読にする
    update public.notifications set read_at = now()
    where sheet_id = new.id and kind = old.status and read_at is null;
  end if;

  if recipient is not null
    and (select notification_channel from public.workspace_settings) = 'in_app' then
    insert into public.notifications (recipient_employee_id, sheet_id, kind, employee_name, period_name)
    select recipient, new.id, new.status, subject.name, period.period_name
    from public.employees as subject, public.evaluation_periods as period
    where subject.id = new.employee_id and period.id = new.period_id;
  end if;
  return null;
end;
$$;
revoke all on function public.notify_next_evaluator() from public, anon, authenticated;

drop trigger if exists evaluation_sheets_notify_next_evaluator on public.evaluation_sheets;
create trigger evaluation_sheets_notify_next_evaluator
  after update of status, primary_evaluator_id, secondary_evaluator_id, no_secondary_evaluator
  on public.evaluation_sheets
  for each row when (
    old.status is distinct from new.status
    or old.primary_evaluator_id is distinct from new.primary_evaluator_id
    or old.secondary_evaluator_id is distinct from new.secondary_evaluator_id
    or old.no_secondary_evaluator is distinct from new.no_secondary_evaluator
  )
  execute function public.notify_next_evaluator();

commit;
