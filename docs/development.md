# 開発・ビルド・PDFの変更

管理者向けの使い方は [README](../README.md) を参照してください。この資料は開発・保守担当者向けです。

## 技術構成

| 担当 | 技術 |
| --- | --- |
| 画面 | Solid、Solid Router、lucide-solid |
| デスクトップ | Tauri 2 |
| ビルド | Vite、Bun |
| DB・認証 | Supabase |
| PDF | Rust、Typst、typst-as-lib、typst-pdf |
| 整形・検査 | Biome、TypeScript、Vitest |

## ローカルで起動する

Bun、Rust、Tauri のビルドに必要な環境を用意し、プロジェクトのルートで実行します。

```powershell
bun install --frozen-lockfile
```

`.env.local` に接続先と公開キーを設定します。既存アカウントに接続する場合は、接続先を確認してください。

```env
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

会社ドメイン、通知の方法、通知メールの SMTP 設定は DB に保存します。SMTP パスワード・service_role キー・署名の秘密鍵を `VITE_*` に入れないでください。

| コマンド | 用途 |
| --- | --- |
| `bun run dev` | 画面をブラウザで起動 |
| `bun run tauri dev` | デスクトップアプリを起動 |
| `bun run build` | フロントエンドのビルド |
| `bun run tauri build` | デスクトップ配布物のビルド |
| `bun run typecheck` | 型検査 |
| `bun run check` | Biome の整形・lint・import 順を検査（警告も失敗扱い） |
| `bun run test:coverage` | TypeScript・画面・SQLのテストとカバレッジ |
| `bun run test:e2e` | 画面のE2E（Playwright）。ローカル Supabase を起動しておく。検証用DB `typa_e2e` を作り直して使い、開発用DBには触れない |
| `bun run docs:user-manual` | [利用者](manual/user.md)・[評価者](manual/evaluator.md)・[管理者](manual/admin.md)のマニュアルの画面写真を、それぞれの権限でログインして撮り直し、`docs/manual/*.pdf` を作る。E2E と同じ `typa_e2e` を使う |
| `bun run test:rust --release` | PDF生成などのRustテスト |
| `bun run fix` | Biomeによる整形と検査 |

本番ビルドは HTTPS の接続先、公開キー、CSP の接続許可を検査します。接続先を変える場合は `src-tauri/tauri.conf.json` の `csp`・`devCsp` も合わせます。

## DBと通知

- 新しい環境の構築、Auth、SMTP、Edge Function の配置は [Supabase 環境の構築手順](supabase-setup.md) を参照してください。
- 既存環境への SQL 適用順とリリースの検証コマンドは [リリース前検証](release-readiness.md) を参照してください。アプリのビルド・配布だけでは本番 DB と Edge Function は更新されません。
- 各 SQL の目的と互換性の経緯は [マイグレーションの変更経緯](migration-history.md) に移しました。
- 通知の方法は Admin が設定画面で選びます（アプリ内通知が既定）。アプリ内通知は、状態の変更と同じトランザクションで DB のトリガーが `notifications` に作り、画面上部のベルで読みます。
- メールのときは `supabase/functions/notify-sheet` が送信します。アプリは関数名とシートIDを渡し、サーバーが認可・宛先の決定・重複防止を行います。メールアドレスとSMTP認証情報はアプリに返しません。SMTP 設定も、この関数が送信テストに成功したときだけ保存します。

## テストの実行環境

Vitest の Node 側は `forks`、最大2ワーカー、ファイルごとの分離を使います。Windows / Node 26 の `threads` では、PGlite の WASM と happy-dom を含む全体実行で、ワーカー初期化・終了の遅延と次のワーカーの起動タイムアウトが発生しました。ファイルごとに独立したプロセスを終了させ、後続のテストに処理系の状態を持ち越さないようにしています。

PGlite の初期化は `beforeAll`、終了は `afterAll` に置きます。`SchemaInventorySql.test.ts` は初期化まで5秒のテスト本体に含めていたため、起動時間だけで失敗していました。他のDBテストと同じ60秒のセットアップ枠へ移し、テスト本体の5秒制限は維持しています。全体のタイムアウト延長やリトライで失敗を隠す設定は入れません。

## 特権操作の保守

Admin のユーザーメニュー「遡及処理」の直下に「特権操作」があります。実施中・締め済みを含む全評価期間のシートを対象に、削除または6状態の任意の状態へ変更できます。状態変更では入力済みの本文・点数を保持し、確定値を解除します。最終評価済みに変更したときはDBで再集計します。評価期間は開き直しません。

処理は `PrivilegedSheetOperationInteractor` → `SupabasePrivilegedSheetRepository` → `privileged_sheet_operation` の順です。RPC が有効な Admin、操作、理由（1〜500文字）、確認した時点の状態を検証し、対象行をロックします。操作・未読依頼の取り下げ・監査記録は同じトランザクションで行い、アプリ内通知もメールも送信しません。

`security_audit_log` の `sheet.privileged_status` / `sheet.privileged_delete` に操作者、対象、期間、前後の状態、理由を記録します。削除時はシート・目標・共通評価・遡及修正履歴の削除前データも残します。監査に失敗した場合、操作全体をロールバックします。特権を認める文脈は、クライアントが書けないテーブルでトランザクションと対象シートに限定し、トリガーを全体的に無効化しません。

配布前に `202610260002_privileged_sheet_operations.sql` を適用してください。アプリのビルド・更新だけでは RPC は追加されません。

## PDFの変更

出力処理は `ExportEvaluationSheetInteractor` → `ExportSheetMapper` → Tauri の `generate_pdf_with_typst` → Typst の順です。画面と同じ `EvaluationSheetRepository.findById` から帳票データを作成します。

帳票デザインは [template.typ](../src-tauri/src/templates/template.typ) にあります。項目を増やす場合は、次のファイルを合わせて変更します。

- `src/application/dtos/ExportSheetDto.ts`
- `src/application/dtos/ExportSheetMapper.ts`
- `src-tauri/src/lib.rs`
- `src-tauri/src/templates/template.typ`

共通評価は保存済みの結果だけでなく項目マスタを基準に組み立てます。シート作成時の等級と、確定時に固定した集計・配点・評価者を保持する仕様は [基本設計書](basic-design.md) を参照してください。

## ディレクトリ

```text
src/
  application/    ユースケース、DTO
  adapter/        コントローラー、プレゼンター、画面
  domain/         エンティティ、権限、集計、リポジトリのインターフェース
  infrastructure/ Supabase・Tauriとの接続
src-tauri/
  src/lib.rs      PDF生成コマンド
  src/templates/  Typstテンプレート、フォント
supabase/
  migrations/     DBの変更履歴
  functions/      通知メールのEdge Function
```
