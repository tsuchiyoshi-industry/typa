-- 既存のワークフロー用マイグレーションは変更せず、目標送信に関するエラーメッセージを現行の表記にそろえる。
begin;

do $migration$
declare
  function_definition text;
  old_message text := 'チャレンジ目標が空欄の目標は提出・確定できません。入力して保存するか、不要なタブを削除してください。';
  new_message text := 'チャレンジ目標が空欄の目標は送信・確定できません。入力して保存するか、不要なタブを削除してください。';
  old_count integer;
  new_count integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.check_evaluation_completion()'::regprocedure
  ) into function_definition;
  old_count := (
    char_length(function_definition) -
    char_length(replace(function_definition, old_message, ''))
  ) / char_length(old_message);
  new_count := (
    char_length(function_definition) -
    char_length(replace(function_definition, new_message, ''))
  ) / char_length(new_message);

  if old_count = 1 and new_count = 0 then
    execute replace(function_definition, old_message, new_message);
  elsif old_count <> 0 or new_count <> 1 then
    raise exception 'Unexpected check_evaluation_completion definition; expected exactly one goal-submission message.';
  end if;

  old_message := 'この社員の、実施中の評価期間の評価シートは提出済みのため、取り込めません。';
  new_message := 'この社員の、実施中の評価期間の評価シートは目標を送信済みのため、取り込めません。';
  select pg_catalog.pg_get_functiondef(
    'public.import_sheet_data(jsonb,jsonb,boolean)'::regprocedure
  ) into function_definition;
  old_count := (
    char_length(function_definition) -
    char_length(replace(function_definition, old_message, ''))
  ) / char_length(old_message);
  new_count := (
    char_length(function_definition) -
    char_length(replace(function_definition, new_message, ''))
  ) / char_length(new_message);

  if old_count = 2 and new_count = 0 then
    execute replace(function_definition, old_message, new_message);
  elsif old_count <> 0 or new_count <> 2 then
    raise exception 'Unexpected import_sheet_data definition; expected exactly two goal-submission messages.';
  end if;
end;
$migration$;

commit;
