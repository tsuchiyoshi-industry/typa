begin;

-- ログアウト・セッションの取り消し・期限(time box)切れの後は、手元に残ったアクセストークン
-- (最長 jwt_expiry)でも、何も読めない・書けないようにする。Web では、トークンがブラウザや
-- 共有 PC に残り得るため。判定は、すべての RLS と RPC が通る current_employee_id() の一箇所に置く。
--
-- session_id のないトークンを Auth は発行しない。作れるのは署名鍵を持つ者だけで、その者は
-- service_role のトークンも作れるので、そこは従来どおり PostgREST の署名の検証に任せる。
-- UUID でない session_id は、無いものとして扱わずにエラーにする。
create or replace function public.current_employee_id()
returns integer language sql stable security definer set search_path = '' as $$
  select e.id from public.employees e
  where e.user_id = auth.uid() and e.is_enabled
    and (auth.jwt() ->> 'session_id' is null
      or exists (select 1 from auth.sessions s
                 where s.id = (auth.jwt() ->> 'session_id')::uuid and s.user_id = auth.uid()
                   and (s.not_after is null or s.not_after > now())))
$$;

-- 設定の 3 つのポリシーだけが Admin の判定を自前で書いていた(利用停止を見ず、セッションも見ない)。
-- 共通の current_employee_is_admin() にそろえる
drop policy "only Admin changes evaluation settings" on public.evaluation_settings;
create policy "only Admin changes evaluation settings"
  on public.evaluation_settings for update to authenticated
  using (public.current_employee_is_admin()) with check (true);
drop policy "only Admin reads workspace settings" on public.workspace_settings;
create policy "only Admin reads workspace settings"
  on public.workspace_settings for select to authenticated
  using (public.current_employee_is_admin());
drop policy "only Admin changes workspace settings" on public.workspace_settings;
create policy "only Admin changes workspace settings"
  on public.workspace_settings for update to authenticated
  using (public.current_employee_is_admin()) with check (true);

-- 判定が 1 行ごとに走らないよう、全テーブル共通の制限ポリシーは 1 クエリ 1 回(initPlan)で評価する
do $$
declare tab text;
begin
  for tab in select tablename from pg_policies
             where schemaname = 'public' and policyname = 'enabled employee required' loop
    execute format('drop policy "enabled employee required" on public.%I', tab);
    execute format('create policy "enabled employee required" on public.%I as restrictive for all to authenticated using ((select public.current_employee_id()) is not null) with check ((select public.current_employee_id()) is not null)', tab);
  end loop;
end $$;

commit;
