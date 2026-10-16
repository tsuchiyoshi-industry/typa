-- Preserve the staged evaluation workflow introduced on 2026-10-08. The server
-- owns final aggregates, and every content write serializes with confirmation.
begin;

-- Lock only the parent; never expose its hidden evaluation columns.
create function public.lock_evaluation_sheet(p_id bigint)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare s public.evaluation_sheets%rowtype; me integer:=public.current_employee_id();
begin
  select * into s from public.evaluation_sheets where id=p_id for update;
  if me is null or not coalesce(me in(s.employee_id,s.primary_evaluator_id,s.secondary_evaluator_id),false) then
    raise exception 'この評価シートを変更する権限がありません。' using errcode='42501';
  end if;
  return jsonb_build_object('id',s.id,'employee_id',s.employee_id,'status',s.status,
    'primary_evaluator_id',s.primary_evaluator_id,'secondary_evaluator_id',s.secondary_evaluator_id);
end;
$$;
revoke all on function public.lock_evaluation_sheet(bigint) from public,anon,authenticated;
grant execute on function public.lock_evaluation_sheet(bigint) to authenticated;

create or replace function public.lock_sheet_content_write()
returns trigger language plpgsql set search_path='' as $$
declare s jsonb; target bigint; me integer; allowed text[];
begin
  target := case when tg_op='DELETE' then old.sheet_id else new.sheet_id end;
  if current_user in ('authenticated','anon') then
    s := public.lock_evaluation_sheet(target);
    me := public.current_employee_id();
    if tg_op='UPDATE' and old.sheet_id is distinct from new.sheet_id then
      raise exception '別のシートに移せません。' using errcode='42501';
    end if;
    if s->>'status'='finalized' then
      raise exception '確定した評価内容は変更できません。' using errcode='42501';
    end if;
    if tg_table_name='milestones' then
      allowed := case
        when me=(s->>'employee_id')::integer and s->>'status'='draft' then array['goal_number','challenge_goal','midterm_goal','achievement']
        when me<>(s->>'employee_id')::integer and me=(s->>'primary_evaluator_id')::integer and s->>'status'='submitted' then array['first_score']
        when me<>(s->>'employee_id')::integer and me=(s->>'secondary_evaluator_id')::integer and s->>'status'='first_evaluated' then array['second_score']
        else '{}'::text[] end;
      if (tg_op in ('INSERT','DELETE') and not coalesce(me=(s->>'employee_id')::integer and s->>'status'='draft',false))
        or (tg_op='UPDATE' and not public.changed_columns(to_jsonb(old),to_jsonb(new)) <@ allowed) then
        raise exception 'この目標を変更する権限がありません。' using errcode='42501';
      end if;
    end if;
  else
    perform 1 from public.evaluation_sheets where id=target for update;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger a_milestones_lock_sheet before insert or update or delete on public.milestones
  for each row execute function public.lock_sheet_content_write();
create trigger a_common_results_lock_sheet before insert or update or delete on public.common_evaluation_results
  for each row execute function public.lock_sheet_content_write();

create or replace function public.save_common_evaluation(p_sheet_id bigint,p_results jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare s public.evaluation_sheets%rowtype; me integer:=public.current_employee_id(); access text;
begin
  select * into s from public.evaluation_sheets where id=p_sheet_id for update;
  access := case when me<>s.employee_id and me=s.primary_evaluator_id and s.status='submitted' then 'first'
                 when me<>s.employee_id and me=s.secondary_evaluator_id and s.status='first_evaluated' then 'second' end;
  if access is null then raise exception 'この共通評価を保存する権限がありません。' using errcode='42501'; end if;
  if jsonb_typeof(p_results) is distinct from 'array' then
    raise exception '評価項目を配列で指定してください。' using errcode='22023';
  end if;
  -- Reject an invalid batch completely, rather than silently discarding unknown items.
  if exists (
    select 1 from jsonb_array_elements(p_results) entry
    left join public.common_evaluation_items i on i.id=(entry->>'itemId')::bigint
    left join public.employee_grades g on g.id=s.grade_id
    where i.id is null or not coalesce(i.item_set_id is null or i.item_set_id=g.item_set_id,false)
      or coalesce(case when access='first' then entry->>'firstScore' else entry->>'secondScore' end,'') !~ '^[0-4]$'
  ) or exists (
    select 1 from jsonb_array_elements(p_results) entry group by entry->>'itemId' having count(*)>1
  ) then raise exception '評価項目または点数が正しくありません。' using errcode='23514'; end if;
  insert into public.common_evaluation_results(sheet_id,item_id,first_score,second_score,first_comment)
  select p_sheet_id,(entry->>'itemId')::bigint,
    case when access='first' then (entry->>'firstScore')::integer else 0 end,
    case when access='second' then (entry->>'secondScore')::integer else 0 end,
    case when access='first' then coalesce(entry->>'firstComment','') else '' end
  from jsonb_array_elements(p_results) entry
  on conflict(sheet_id,item_id) do update set
    first_score=case when access='first' then excluded.first_score else common_evaluation_results.first_score end,
    first_comment=case when access='first' then excluded.first_comment else common_evaluation_results.first_comment end,
    second_score=case when access='second' then excluded.second_score else common_evaluation_results.second_score end,
    updated_at=now();
end;
$$;

create function public.freeze_evaluation_totals()
returns trigger language plpgsql security definer set search_path='' as $$
declare ofirst numeric; osecond numeric; omax numeric; cfirst numeric; csecond numeric; cmax numeric;
  oa integer; ca integer; primary_final boolean; primary_score integer;
begin
  if new.status is not distinct from old.status or new.status not in('first_evaluated','finalized') then return new; end if;
  -- The sheet row is locked by UPDATE. All goal/common writes acquire the same lock.
  select coalesce(sum(first_score),0),coalesce(sum(second_score),0),count(*)*4
    into ofirst,osecond,omax from public.milestones where sheet_id=new.id;
  select coalesce(sum(i.weight*coalesce(r.first_score,0)),0),coalesce(sum(i.weight*coalesce(r.second_score,0)),0),coalesce(sum(i.weight*4),0)
    into cfirst,csecond,cmax from public.common_evaluation_items i
    left join public.common_evaluation_results r on r.item_id=i.id and r.sheet_id=new.id
    left join public.employee_grades g on g.id=new.grade_id
    where i.item_set_id is null or i.item_set_id=g.item_set_id;
  select objective_allocation,common_allocation into oa,ca from public.evaluation_settings for share;
  primary_final := new.no_secondary_evaluator and new.secondary_evaluator_id is null;
  primary_score := coalesce(round(ofirst*oa/nullif(omax,0)),0)+coalesce(round(cfirst*ca/nullif(cmax,0)),0);
  if new.status='first_evaluated' or primary_final then new.first_rank:=public.evaluation_rank(primary_score); end if;
  if new.status='finalized' then
    new.objectives_first_total_score:=ofirst;
    new.objectives_first_total_rate:=coalesce(round(ofirst*100/nullif(omax,0)),0);
    new.common_evaluation_first_total_score:=cfirst;
    new.common_evaluation_first_total_rate:=coalesce(round(cfirst*100/nullif(cmax,0)),0);
    if primary_final then osecond:=ofirst; csecond:=cfirst; end if;
    new.objectives_second_total_score:=osecond;
    new.objectives_second_total_rate:=coalesce(round(osecond*100/nullif(omax,0)),0);
    new.common_evaluation_second_total_score:=csecond;
    new.common_evaluation_second_total_rate:=coalesce(round(csecond*100/nullif(cmax,0)),0);
    new.objectives_second_evaluation_score:=coalesce(round(osecond*oa/nullif(omax,0)),0);
    new.common_evaluation_second_evaluation_score:=coalesce(round(csecond*ca/nullif(cmax,0)),0);
    new.total_evaluation_score:=new.objectives_second_evaluation_score+new.common_evaluation_second_evaluation_score;
    new.objective_allocation:=oa; new.common_allocation:=ca;
    new.final_rank_letter:=left(public.evaluation_rank(new.total_evaluation_score),1);
    new.final_rank_level:=case right(public.evaluation_rank(new.total_evaluation_score),1) when '+' then 'plus' when '-' then 'minus' else 'none' end;
  end if;
  return new;
end;
$$;
revoke all on function public.freeze_evaluation_totals() from public,anon,authenticated;
-- Run before the existing access/rank guard: even direct API clients cannot choose totals.
create trigger a_evaluation_sheets_freeze_totals before update of status on public.evaluation_sheets
  for each row execute function public.freeze_evaluation_totals();

-- One transaction for the state transition, aggregation, rank and audit event.
create function public.transition_evaluation_sheet(p_sheet_id bigint,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.evaluation_sheets%rowtype; me integer:=public.current_employee_id(); primary_final boolean;
begin
  select * into s from public.evaluation_sheets where id=p_sheet_id for update;
  if me is null or s.id is null then raise exception 'ログインが必要です。' using errcode='42501'; end if;
  primary_final:=s.no_secondary_evaluator and s.secondary_evaluator_id is null;
  if not coalesce(case s.status||'>'||p_status
    when 'draft>submitted' then me=s.employee_id
    when 'submitted>draft' then me=s.employee_id
    when 'submitted>first_evaluated' then me=s.primary_evaluator_id and me<>s.employee_id and not primary_final
    when 'submitted>finalized' then me=s.primary_evaluator_id and me<>s.employee_id and primary_final
    when 'first_evaluated>finalized' then me<>s.employee_id and (me=s.secondary_evaluator_id or (me=s.primary_evaluator_id and primary_final))
  end,false) then raise exception 'この評価シートの状態を変更する権限がありません。' using errcode='42501'; end if;
  update public.evaluation_sheets set status=p_status,updated_at=now() where id=p_sheet_id;
  return public.get_sheet(p_sheet_id);
end;
$$;
revoke all on function public.transition_evaluation_sheet(bigint,text) from public,anon,authenticated;
grant execute on function public.transition_evaluation_sheet(bigint,text) to authenticated;

create function public.audit_sheet_transition()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.status is distinct from new.status then
    insert into public.security_audit_log(actor_user_id,action,entity_id,details)
    values(auth.uid(),'sheet.status',new.id,jsonb_build_object('from',old.status,'to',new.status));
  end if;
  return null;
end;
$$;
revoke all on function public.audit_sheet_transition() from public,anon,authenticated;
create trigger evaluation_sheets_audit after update of status on public.evaluation_sheets
  for each row execute function public.audit_sheet_transition();
commit;
