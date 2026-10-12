# typa

人事考課システムの評価シート作成・更新・PDF出力を行う Tauri デスクトップアプリです。

フロントエンドは Solid + Vite、データストアは Supabase、PDF生成は Tauri/Rust 側で Typst を使います。最終成果物は `ExportEvaluationSheetInteractor` から生成される人事考課評価シートPDFです。

## 主な機能

- 社員番号とパスワードによるログイン（Supabase Auth。メールアドレスは新規登録時の認証コード受け取りにだけ使用）
- 評価期間ごとの評価シート作成
- チャレンジ目標・マイルストーンの登録、更新、評価
- 役職共通評価項目の表示、登録、更新、評価
- 一次評価者・二次評価者の権限に応じた編集制御
- 評価の進行は「下書き → 一次評価待ち → 二次評価待ち → 最終評価済み」。一次評価者が一次評価を確定すると変更できなくなり、二次評価者へ通知して二次評価が始まる（二次評価者「なし」の社員は、一次評価者の確定がそのまま評価確定）。下書きは評価者に表示しない
- 評価ランクは評価者が選ばず、評価点（100点満点）の得点率で決まる（95%以上 S / 90% A / 80% B+ / 60% B / 50% B- / 40% C / それ未満 D）。一次評価・最終評価のそれぞれについて、確定した時点のランクを保存する
- 評価者向け「受け持ちの評価」（`/review`）。受け持ち全員の進捗、自分の番（一次評価する・二次評価する）・一次評価者ラベル・等級による絞り込み、一覧を残した連続評価、同等級の横断比較に対応
- 社員マスタの「評価構造」表示（Reviewer・Admin）。評価を確定する二次評価者、一次評価者、評価される社員を3列で示し、評価者が未設定の社員もまとめて確認できる
- Typst テンプレートによる評価シートPDF出力

## 技術構成

- UI: Solid, Solid Router, lucide-solid
- Desktop: Tauri 2
- Build: Vite
- Database/Auth: Supabase
- PDF: Typst, typst-as-lib, typst-pdf
- Format/Lint: Biome

## セットアップ

依存関係をインストールします。

```powershell
bun install
```

Supabase 接続用の環境変数を設定します。`.env` などに以下を用意してください。

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

Supabase の環境を新しく作る手順と、どこに何を設定しているかの一覧は、[Supabase 環境の構築手順と設定一覧](docs/supabase-setup.md) にあります。DB 構成は [基本設計書の 8 章](docs/basic-design.md#8-データ設計) と `supabase/migrations/` を参照してください。実装では `evaluation_sheets`, `milestones`, `common_evaluation_items`, `common_evaluation_results`, `employees`, `evaluation_periods` などを参照します。

受け持ちの評価には `supabase/migrations/202610070001_reviewer_workspace.sql` と `202610080001_evaluation_stages.sql` の適用が必要です。既存の「二次評価者なし」「共通評価項目セット」のマイグレーションを先に適用してください。`202610080001` は `evaluation_sheets.first_rank`（一次評価ランク）と状態 `first_evaluated` を追加し、評価者ごとの確認記録（`sheet_review_checkpoints` と `set_sheet_reviewed`）を削除します。0点を未入力・完了の判定には使いません。一次評価者向けの二次評価・最終結果の非表示、下書きの非表示、一次評価確定の通知先の取得を RPC 側で制御しています。状態の遷移と評価の編集可否は、アプリ側のポリシーに加えて、`202610120001_access_control.sql` から DB 側でも強制しています。

`202610080002_sheet_grade.sql` は `evaluation_sheets.grade_id`（シート作成時の等級）を追加します。等級は挿入時に DB のトリガーが社員の等級から設定し、その後に社員の等級が変わっても書き換えません。評価シート一覧にはこの等級を表示します。PDF を出力できるのは、評価が確定したシートの本人と評価者（一次・二次）です。評価関係のない社員は出力できません。PDF は誰が出力しても同じ内容で、伏せ字にはしません。

`202610080006_reviewer_workspace_sheet_grade.sql` と `202610080007_evaluation_completion_sheet_grade.sql` は、「部下の評価」の一覧と確定時の未評価チェックが使う共通評価の項目を、社員の現在の等級ではなくシート作成時の等級（`evaluation_sheets.grade_id`）に揃えます。昇級後に過去のシートを開いても、作成時の等級の項目のままです。

`202610080008_evaluation_period_management.sql` は、評価期間の管理と期間締めです。Admin が設定画面で評価期間を追加・変更・削除し、「この期間を開始する」で次の期間を実施中にすると、それまで実施中だった期間が同時に締められます（DB 関数 `activate_evaluation_period`）。実施中の期間は常に 1 つで、`is_active` はクライアントから直接は書き換えられません。締める期間に未確定の評価シートが残っていると締められません。締めた期間の評価シート・チャレンジ目標・共通評価の結果は、DB のトリガーが追加・更新・削除を拒否します（閲覧と PDF 出力はできます）。間違えて締めた場合は、元の期間をもう一度開始すれば戻せます。適用時に実施中の期間が複数あるとマイグレーションが失敗するので、先に 1 つにしてください。締めた期間のシートを後からマイグレーションで書き換える場合は、そのマイグレーションの中でトリガーを一時的に無効にする必要があります。

`202610080009_sheet_evaluators.sql` は、評価シートに評価者（`primary_evaluator_id`、`secondary_evaluator_id`、`no_secondary_evaluator`）を持たせます。シートの作成時に社員マスタの評価者が入り、未確定の間は社員マスタでの付け替えが反映されます。評価が確定したシートの評価者は変わらないので、次の期間に向けて評価者を付け替えても、過去のシートは評価した人のまま閲覧・PDF 出力できます。既存のシートには、適用時点の社員マスタの評価者が入ります。`202610080008` の後に適用してください。

`202610080010_notifications_by_sheet_evaluators.sql` は、通知先の取得（一次評価の確定・評価の確定）と確定時の未評価チェックを、社員マスタではなくシートの評価者で判定するように直します。`202610080011_unique_rows.sql` は、評価期間・社員ごとに 1 シート、シート・目標番号ごとに 1 目標、シート・項目ごとに 1 結果の一意制約を揃えます（本番に既にあるものはそのまま、`milestones` の分を追加）。`milestones` に同じシート・同じ目標番号の行が重複していると失敗するので、その場合は先に重複を解消してください。目標の保存はこの制約を使うため、アプリの配布前に適用が必要です。

`202610080013_workspace_settings.sql` は、ワークスペース全体の設定（`workspace_settings`、常に1行）を追加します。会社のメールドメイン（旧 `VITE_REQUIRED_DOMAIN`）と、通知メールの SMTP 設定（旧 `VITE_SMTP_*`）をここに持ちます。ログイン画面がこのマイグレーションの DB 関数で会社ドメインを読むため、**アプリの配布前に適用が必要です**。会社ドメインは、登録済みアカウントの内部用アドレスから自動で入ります。SMTP 設定は空で始まるので、適用後に Admin が設定画面の「通知メール」で登録してください（登録するまで通知メールは送れず、確定のたびにエラーのトーストが出ます）。アカウントが1件もない環境では、`update public.workspace_settings set required_domain = 'example.jp';` を実行してください。

`202610120001`〜`202610120010` は、アクセス制御を DB 側へ移すマイグレーションです。**適用の順番を守ってください**（[基本設計書 13.3](docs/basic-design.md#133-アクセス制御のマイグレーションを当てる順番)）。

- `202610120001_access_control.sql`: 行レベルセキュリティと列権限・トリガーで、「誰が・どの段階で・どの項目を」読み書きできるかを DB が決めます。ログイン前（anon）は会社ドメインの取得だけ、社員は自分の関係者とシートだけ、という範囲になります。確定時に保存する評価点と評価ランクは、DB が点数から計算し直して一致を確かめます。配布済みの 0.9.8 は、新規登録を除いてそのまま動きます。
- `202610120002_registration.sql`: 新規登録を DB 関数（`begin_registration` / `complete_registration`）に移します。会社のメールアドレスを認証コードで確認したセッションだけが登録を始められ、通知の宛先は `employee_contacts` に DB が控えます。**0.9.8 以前のアプリからは新規登録できなくなります**（ログインと評価は続けられます）。
- `202610120003_sheet_api.sql`: 評価シートを 1 回で読む `get_sheet`、共通評価をまとめて保存する `save_common_evaluation`、通知用の `get_sheet_notification` を追加します。
- `202610120010_after_app_update.sql`: **配布済みのアプリがすべて 0.9.8 より新しくなり、Edge Function `notify-sheet` の送信を確認した後に**適用します。SMTP 設定と通知先を返す DB 関数を削除し、評価の値をテーブルから直接読めなくします。0.9.8 以前のアプリは、これ以降は動きません。

`202610130001_keep_signed_in.sql` は、アプリを閉じた後もログインを残すかどうかを、社員ごとに持たせます（`employees.keep_signed_in`。初めは全員「残さない」）。Admin が社員マスタの「ログイン」で切り替えます。共有 PC を使う社員は「閉じたらログアウト」のままにしてください。この列を読むアプリの配布前に適用します。

`202610040000_baseline.sql` は、2026-10-07 時点の本番スキーマのダンプです。新しい環境をこのリポジトリだけから作るためのもので、既存の環境には適用しません。

`202610080003_employee_roles.sql` は、Admin が社員マスタから TYPA の権限（Admin / Reviewer / Employee）を変えるための DB 関数 `set_employee_role` を追加します。最後の Admin は外せません。あわせて、クライアントから `employees.role_id` を直接更新する権限を外します（`employees` に列を追加したら、クライアントから更新させる列はこのマイグレーションと同じ形で `grant update` が必要です）。誰がどの権限かは Admin の画面にだけ表示しますが、`role_id` の読み取り自体は、行を読める相手には DB 側で制限していません。

## 開発

フロントエンドのみ起動:

```powershell
bun run dev
```

Tauri アプリとして起動:

```powershell
bun run tauri dev
```

ビルド:

```powershell
bun run build
```

Tauri バンドル作成:

```powershell
bun run tauri build
```

整形:

```powershell
bun run fix
```

## PDF出力

PDF出力は以下の流れです。

1. `ExportEvaluationSheetInteractor` が、画面と同じ評価シート（`EvaluationSheetRepository.findById`。DB 関数 `get_sheet`）から `ExportSheetMapper` で帳票データを作る
2. Tauri の `generate_pdf_with_typst` コマンドへデータと保存先を渡す
3. Rust 側で `src-tauri/src/templates/template.typ` にデータを注入
4. Typst でPDFを生成して保存

帳票デザインは [template.typ](./src-tauri/src/templates/template.typ) に集約しています。PDFに追加したい項目がある場合は、以下を合わせて更新してください。

- `src/application/dtos/ExportSheetDto.ts`
- `src/application/dtos/ExportSheetMapper.ts`
- `src-tauri/src/lib.rs`
- `src-tauri/src/templates/template.typ`

## 実装メモ

セキュリティ設計と残っている課題、テストの構成は、[基本設計書](docs/basic-design.md) の 12 章・13 章にまとめています。`bun run test:coverage`、`bun run typecheck`、`bun run test:rust` を配布前に実行します。秘密鍵・SMTPパスワード・Supabase管理キー等を `VITE_*` に含めるビルドは拒否します。

## 通知メール

本人が提出したときは一次評価者へ、一次評価者が一次評価を確定したときは二次評価者へ、評価が確定したときは一次・二次評価者へ通知します。宛先は、評価者が新規登録のときに認証コードで確認したメールアドレスです。同じ宛先は 1 通にまとめ、評価者ごとに別のメールで送ります。通知を送るかどうかは、確定の確認ダイアログのチェックボックスで選べます（初めは「送る」）。送信は状態の保存の後に行い、結果は宛先ごとにトーストで表示します。宛先が未登録・送信失敗の場合も、提出・確定は維持します。自動再送はありません。

送信するのは Supabase の Edge Function（[supabase/functions/notify-sheet](supabase/functions/notify-sheet/index.ts)）です。アプリは「どのシートか」だけを伝え、誰に送るか・呼び出した人がその操作をした本人かは DB 関数 `get_sheet_notification` が決めます。宛先のメールアドレスと SMTP のパスワードは、アプリには渡りません。

```powershell
npx supabase functions deploy notify-sheet
```

SMTP のホスト・ポート・送信元メールアドレス・パスワードは、Admin が設定画面の「通知メール」で登録します（DB の `workspace_settings`）。**Edge Function からはポート 25 と 587 に接続できない**ため、ポートは 465（TLS）を登録してください。メールサーバーが 465 を受け付けない場合は、2525 などの代替ポートか、HTTP API で送るメールサービスが必要です。465 以外のポートでは STARTTLS を必須にしており、暗号化できない接続では送りません。

Supabase Auth の「Confirm email」は無効にし、メールテンプレートに `{{ .Token }}` を含めます。あわせて、Authentication > Hooks の「Before User Created」に Postgres 関数 `public.hook_before_user_created` を設定してください。会社ドメインのメールアドレスと、登録の途中にある社員のログイン用アドレス以外では、アカウントが作られなくなります。

- `evaluation_sheets`（評価期間・社員）、`milestones`（シート・目標番号）、`common_evaluation_results`（シート・項目）は、それぞれ一意制約を持ちます。シートの作成と目標の保存は、この制約を使った `upsert(... onConflict)` で、共通評価の保存は DB 関数 `save_common_evaluation` で行います。
- 共通評価は `common_evaluation_results` が0件でも、`common_evaluation_items` を基準に未入力行を表示します。
- 評価シートPDFも、登録済み結果だけでなく評価項目マスタを基準に出力します。

## ディレクトリ概要

```text
src/
  application/   usecase と DTO
  adapter/       controller, presenter, view
  domain/        entity, repository interface, domain service
  infrastructure Supabase repository 実装
src-tauri/
  src/lib.rs     PDF生成コマンド
  src/templates  Typst テンプレートとフォント
```

`202610080012_challenge_goal_tabs.sql` はチャレンジ目標を1〜4件に変更し、評価者の一覧でも4件表示します。空欄（空白のみも含む）のある目標は提出・確定をDBでも拒否します。目標タブの追加・削除を使う前に適用してください。
