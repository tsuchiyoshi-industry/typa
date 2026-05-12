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
