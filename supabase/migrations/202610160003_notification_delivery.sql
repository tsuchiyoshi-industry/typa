-- One notification per state transition. Failures can be retried deliberately,
-- with a cooldown and an attempt limit; concurrent requests cannot send twice.
begin;
alter table public.evaluation_sheets add column notification_revision uuid not null default gen_random_uuid();
create function public.refresh_notification_revision()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.status is distinct from new.status then new.notification_revision:=gen_random_uuid(); end if;
  return new;
end;
$$;
revoke all on function public.refresh_notification_revision() from public,anon,authenticated;
-- After the invoker column guard; this is a server-owned field, never client input.
create trigger z_evaluation_sheets_notification_revision before update of status on public.evaluation_sheets
  for each row execute function public.refresh_notification_revision();

create table public.sheet_notification_deliveries (
  sheet_id bigint not null references public.evaluation_sheets(id) on delete cascade,
  revision uuid not null,
  claim_id uuid not null default gen_random_uuid(),
  state text not null check(state in('sending','sent','failed')),
  attempts integer not null default 1,
  attempted_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key(sheet_id,revision)
);
alter table public.sheet_notification_deliveries enable row level security;
revoke all on public.sheet_notification_deliveries from public,anon,authenticated;

create function public.claim_sheet_notification(p_sheet_id bigint,p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare revision_id uuid; notification jsonb; delivery public.sheet_notification_deliveries%rowtype;
begin
  select notification_revision into revision_id from public.evaluation_sheets where id=p_sheet_id for update;
  notification:=public.get_sheet_notification(p_sheet_id,p_actor);
  if notification->>'status'='finalized' then return jsonb_build_object('skipped','finalized'); end if;
  select * into delivery from public.sheet_notification_deliveries where sheet_id=p_sheet_id and revision=revision_id for update;
  if delivery.state='sent' then return jsonb_build_object('skipped','sent','notification',notification); end if;
  if delivery.attempts>=5 then return jsonb_build_object('skipped','limit'); end if;
  -- Reverting and resubmitting must not bypass the per-sheet rate limit.
  if (select coalesce(sum(attempts),0) from public.sheet_notification_deliveries
      where sheet_id=p_sheet_id and attempted_at>now()-interval '10 minutes')>=5 then
    return jsonb_build_object('skipped','rate_limit');
  end if;
  if (delivery.state='sending' and delivery.attempted_at>now()-interval '5 minutes')
    or (delivery.state='failed' and delivery.attempted_at>now()-interval '1 minute') then
    return jsonb_build_object('skipped','cooldown');
  end if;
  insert into public.sheet_notification_deliveries(sheet_id,revision,state)
  values(p_sheet_id,revision_id,'sending')
  on conflict(sheet_id,revision) do update set claim_id=gen_random_uuid(),state='sending',
    attempts=sheet_notification_deliveries.attempts+1,attempted_at=now(),completed_at=null
  returning * into delivery;
  return jsonb_build_object('claimId',delivery.claim_id,'notification',notification);
end;
$$;
revoke all on function public.claim_sheet_notification(bigint,uuid) from public,anon,authenticated;
grant execute on function public.claim_sheet_notification(bigint,uuid) to service_role;

create function public.complete_sheet_notification(p_claim_id uuid,p_success boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.sheet_notification_deliveries set state=case when p_success then 'sent' else 'failed' end,completed_at=now()
  where claim_id=p_claim_id and state='sending';
  return found;
end;
$$;
revoke all on function public.complete_sheet_notification(uuid,boolean) from public,anon,authenticated;
grant execute on function public.complete_sheet_notification(uuid,boolean) to service_role;
commit;
