# typa

人事考課システムの評価シート作成・更新・PDF出力を行う Tauri デスクトップアプリです。

フロントエンドは Solid + Vite、データストアは Supabase、PDF生成は Tauri/Rust 側で Typst を使います。最終成果物は `ExportEvaluationSheetInteractor` から生成される人事考課評価シートPDFです。

## 主な機能

- Supabase Auth によるログイン
- 評価期間ごとの評価シート作成
- チャレンジ目標・マイルストーンの登録、更新、評価
- 役職共通評価項目の表示、登録、更新、評価
- 一次評価者・二次評価者の権限に応じた編集制御
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

二次評価者が評価を確定した後、対象社員の一次・二次評価者の認証済み登録メール（Supabase Auth）へ個別に通知します。同じ宛先は1通にまとめます。固定宛先の `VITE_SHEET_FINALIZED_NOTIFY_TO` は使用しません。提出時・一次評価完了時の通知はありません。登録メール未設定や送信失敗の場合も確定は維持し、画面に通知警告を表示します。自動再送はありません。

配布前に [通知先取得マイグレーション](supabase/migrations/202610050001_evaluation_notification_recipients.sql) をステージングで確認してからSupabaseへ適用してください。社員の `user_id` が登録ユーザーに紐付いている必要があります。追加email列は不要です。このDB関数は確定済みシートの二次評価者だけに宛先取得を許可します。

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
