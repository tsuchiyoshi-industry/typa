# typa

人事考課システムの評価シート作成・更新・PDF出力を行う Tauri デスクトップアプリです。

フロントエンドは Solid + Vite、データストアは Supabase、PDF生成は Tauri/Rust 側で Typst を使います。最終成果物は `ExportEvaluationSheetInteractor` から生成される人事考課評価シートPDFです。

## 主な機能

- 社員番号とパスワードによるログイン（Supabase Auth。メールアドレスは新規登録時の認証コード受け取りにだけ使用）
- 評価期間ごとの評価シート作成
- チャレンジ目標・マイルストーンの登録、更新、評価
- 役職共通評価項目の表示、登録、更新、評価
- 一次評価者・二次評価者の権限に応じた編集制御
- 評価の進行は「下書き → 提出済み → 一次評価済み → 評価確定」。一次評価者が一次評価を確定すると変更できなくなり、二次評価者へ通知して二次評価が始まる（二次評価者「なし」の社員は、一次評価者の確定がそのまま評価確定）。下書きは評価者に表示しない
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

DB構成は [tables.md](./tables.md) を正とします。実装では `evaluation_sheets`, `milestones`, `common_evaluation_items`, `common_evaluation_results`, `employees`, `evaluation_periods` などを参照します。

受け持ちの評価には `supabase/migrations/202610070001_reviewer_workspace.sql` と `202610080001_evaluation_stages.sql` の適用が必要です。既存の「二次評価者なし」「共通評価項目セット」のマイグレーションを先に適用してください。`202610080001` は `evaluation_sheets.first_rank`（一次評価ランク）と状態 `first_evaluated` を追加し、評価者ごとの確認記録（`sheet_review_checkpoints` と `set_sheet_reviewed`）を削除します。0点を未入力・完了の判定には使いません。一次評価者向けの二次評価・最終結果の非表示、下書きの非表示、一次評価確定の通知先の取得を RPC 側で制御しています。状態の遷移と評価の編集可否はアプリ側のポリシーで判定しており、DB 側の強制は SEC-002 の対象のままです。

`202610080002_sheet_grade.sql` は `evaluation_sheets.grade_id`（シート作成時の等級）を追加します。等級は挿入時に DB のトリガーが社員の等級から設定し、その後に社員の等級が変わっても書き換えません。評価シート一覧にはこの等級を表示します。PDF を出力できるのは、評価が確定したシートの本人と評価者（一次・二次）です。評価関係のない社員は出力できません。PDF は誰が出力しても同じ内容で、伏せ字にはしません。

`202610080006_reviewer_workspace_sheet_grade.sql` と `202610080007_evaluation_completion_sheet_grade.sql` は、「部下の評価」の一覧と確定時の未評価チェックが使う共通評価の項目を、社員の現在の等級ではなくシート作成時の等級（`evaluation_sheets.grade_id`）に揃えます。昇級後に過去のシートを開いても、作成時の等級の項目のままです。

`202610080003_employee_roles.sql` は、Admin が社員マスタから TYPA の権限（Admin / Reviewer / Employee）を変えるための DB 関数 `set_employee_role` を追加します。最後の Admin は外せません。あわせて、クライアントから `employees.role_id` を直接更新する権限を外します（`employees` に列を追加したら、クライアントから更新させる列はこのマイグレーションと同じ形で `grant update` が必要です）。誰がどの権限かは Admin の画面にだけ表示しますが、`role_id` の読み取り自体は DB 側で制限していません（SEC-002 の対象）。

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

1. `ExportEvaluationSheetInteractor` が `EvaluationSheetRepository.findExportData` から帳票データを取得
2. Tauri の `generate_pdf_with_typst` コマンドへデータと保存先を渡す
3. Rust 側で `src-tauri/src/templates/template.typ` にデータを注入
4. Typst でPDFを生成して保存

帳票デザインは [template.typ](./src-tauri/src/templates/template.typ) に集約しています。PDFに追加したい項目がある場合は、以下を合わせて更新してください。

- `src/application/dtos/ExportSheetDto.ts`
- `src/domain/repositories/EvaluationSheetRepository.ts`
- `src/infrastructure/repositories/SupabaseEvaluationSheetRepository.ts`
- `src-tauri/src/lib.rs`
- `src-tauri/src/templates/template.typ`

## 実装メモ

リリース前の問題一覧・単体テスト・DB/認証の追加検証は [セキュリティ監査](security/RELEASE-AUDIT.md) を参照してください。`bun run test:coverage`、`bun run typecheck`、`bun run test:rust` を配布前に実行します。通知専用SMTPパスワードの配布リスクは受容済みとし、その他の秘密鍵・Supabase管理キー等を `VITE_*` に含めるビルドは拒否します。

## 評価確定メール

二次評価者が評価を確定した後、対象社員の一次・二次評価者が新規登録時に認証コードを受け取ったメールアドレスへ個別に通知します。同じ宛先は1通にまとめます。固定宛先の `VITE_SHEET_FINALIZED_NOTIFY_TO` は使用しません。提出時・一次評価完了時の通知はありません。登録メール未設定や送信失敗の場合も確定は維持し、画面に通知警告を表示します。自動再送はありません。

配布前に [通知先取得マイグレーション](supabase/migrations/202610050001_evaluation_notification_recipients.sql) と、後続の `supabase/migrations/` 内のマイグレーションをステージングで確認してからSupabaseへ適用してください。Supabase Authの「Confirm email」は無効にし、メールテンプレートに `{{ .Token }}` を含めます。社員の `user_id` が登録ユーザーに紐付いている必要があります。追加email列は不要です。このDB関数は確定済みシートの二次評価者だけに宛先取得を許可します。

GitHub Actions Secretsに `VITE_SMTP_HOST`、`VITE_SMTP_PORT`、`VITE_SMTP_USER`、`VITE_SMTP_PASSWORD` を設定します。実際の送信はTauriのRust側です。資格情報は配布アプリへ含まれるため、パスワードの定期更新時はアプリも更新配布します。

- `milestones` と `common_evaluation_results` は、DB側に複合ユニーク制約がない前提で実装しています。
- そのため保存処理では Supabase の `upsert(... onConflict)` に依存せず、既存行検索から `update` / `insert` を分岐します。
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
