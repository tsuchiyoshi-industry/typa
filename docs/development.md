# 開発・ビルド・PDFの変更

管理者向けの使い方は [README](../README.md) を参照してください。この資料は開発・保守担当者向けです。

## 技術構成

| 担当         | 技術                                 |
| ------------ | ------------------------------------ |
| 画面         | Solid、Solid Router、lucide-solid    |
| デスクトップ | Tauri 2                              |
| ビルド       | Vite、Bun                            |
| DB・認証     | Supabase                             |
| PDF          | Rust、Typst、typst-as-lib、typst-pdf |
| 整形・検査   | Biome、TypeScript、Vitest            |

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

| コマンド                      | 用途                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun run dev`                 | 画面をブラウザで起動                                                                                                                                                                                                                                                                                                                                                                                               |
| `bun run tauri dev`           | デスクトップアプリを起動                                                                                                                                                                                                                                                                                                                                                                                           |
| `bun run build`               | フロントエンドのビルド                                                                                                                                                                                                                                                                                                                                                                                             |
| `bun run tauri build`         | デスクトップ配布物のビルド                                                                                                                                                                                                                                                                                                                                                                                         |
| `bun run typecheck`           | 型検査                                                                                                                                                                                                                                                                                                                                                                                                             |
| `bun run check`               | Biome の整形・lint・import 順を検査（警告も失敗扱い）                                                                                                                                                                                                                                                                                                                                                              |
| `bun run test:coverage`       | TypeScript・画面・SQLのテストとカバレッジ                                                                                                                                                                                                                                                                                                                                                                          |
| `bun run test:security`       | 攻撃入力・認可・通知API・CSV・Tauri設定の回帰テスト。範囲と未検証項目は [セキュリティ検証](security-verification.md) を参照                                                                                                                                                                                                                                                                                        |
| `bun run bench`               | Vitest 5 の `bench` fixture で計測。ViewModel は1,000・10,000件、画面は30・300人で表示・検索・再読込などを測る。通常テストと分離し、専用CI（`benchmark.yml`）で結果JSONを保存。対象は `*.bench.ts(x)`                                                                                                                                                                                                              |
| `bun run test:e2e`            | 画面のE2E（Playwright）。ローカル Supabase を起動しておく。検証用DB `typa_e2e` を作り直して使い、開発用DBには触れない                                                                                                                                                                                                                                                                                              |
| `bun run docs:user-manual`    | [利用者](manual/user.md)・[評価者](manual/evaluator.md)・[管理者](manual/admin.md)のマニュアルの画面写真を、それぞれの権限でログインして撮り直し、`docs/manual/*.pdf` を作る。E2E と同じ `typa_e2e` を使う。写真と PDF は git に置かず、CI が E2E の後に作ってリリースに添える（写真はアプリのヘルプにも入る）。手元で確かめたいときだけ実行する。撮っていなくても、アプリはヘルプの写真なしでビルド・テストできる |
| `bun run test:rust --release` | PDF生成などのRustテスト                                                                                                                                                                                                                                                                                                                                                                                            |
| `bun run fix`                 | Biomeによる整形と検査                                                                                                                                                                                                                                                                                                                                                                                              |

`test:e2e` と `docs:user-manual` はローカル Supabase が必要です。Docker Desktop を起動し、TYPA のコンテナがまだ動いていなければ、プロジェクトのルートで `bunx supabase@2.121.0 start` を実行します。Docker と PostgreSQL の起動が完了してから、`bun run docs:user-manual` を実行してください。起動前チェックで、Docker への接続、必要なコンテナ、PostgreSQL の準備状態を確認します。

画面と REST 検証のログインは同じ IP の Auth 制限を共有します。高速な CI では短時間の上限（30回）に達するため、テスト用のログイン処理は HTTP 429 のときだけ 2.1 秒待って最大5回再試行します。認証設定は変更せず、誤ったパスワードなど他の応答はそのまま検証します。E2E は実際に制限に達してから REST・画面の両方でログインできることも確認します。

本番ビルドは HTTPS の接続先、公開キー、CSP の接続許可を検査します。接続先を変える場合は `src-tauri/tauri.conf.json` の `csp`・`devCsp` も合わせます。

ベンチマークは `*.bench.ts(x)` に `test("名前", async ({ bench }) => { ... })` の形式で追加します。`bench(...).run()` と `bench.compare(...)` を使い、ウォームアップ・サンプル集計は Vitest 5 に任せます。表示の計測では後片付けを `bench` の `afterEach` フックに置き、時間から外します。

画面は Node.js 上の happy-dom で DOM の構築・更新を測ります。ブラウザのレイアウト・描画は含みません。平均・p99・RME・サンプル数を確認し、性能比較は同じ実行環境で行ってください。ソースを直接読み込むため、ViewModel の測定には Vitest のモジュール変換による getter のコストも含まれ、警告が出る場合があります。JSON は `.vitest/bench/results.json`（git 管理対象外）、CI では `benchmark-results` アーティファクトに保存します。

### ChromiumでのUI計測

`bun run bench:browser` は Vitest 5 Browser Mode と Playwright の Chromium で、社員マスタと評価者画面に300人分を表示して測ります。初回は `bunx playwright install --only-shell chromium` を実行してください。通常のテスト・happy-dom の bench とは別の設定です。

- 実際のアプリの CSS、1440×900 の表示領域、ライトテーマを使用します。Solid は `dev: false` と production の解決条件で実行します（配信は Vitest/Vite のテスト環境で、製品ビルドそのものではありません）。データと Controller は固定の fixture で、DB・認証・ネットワーク取得は計測に含みません。
- 初期表示、検索の1入力（「社員」→「社員1」）、評価者画面のグループ化の有効化を別々に測ります。各30サンプル・ウォームアップ5回。検索の準備とグループ化の解除は計測の外です。
- 入力は1回の `input` イベントを発火させ、操作後の2回目の `requestAnimationFrame` まで待ちます。表示フレームまでの時間の目安であり、実キーボード入力の INP、厳密なピクセル提示時刻ではありません。フレーム待ちのため軽い操作でも約1〜2フレームの時間を含みます。
- 集計結果は `.vitest/bench/browser/results.json` に保存します。統計計測とは別に各操作を1回ずつトレースし、`*.trace.json`、`*.summary.json` と画面写真も同じディレクトリに保存します。CI の `benchmark-results` に一緒に添付します。
- `*.trace.json` は Chrome DevTools の Performance パネルの「Load profile」で開けます。`typa:<操作名>:start/end` の間が対象です。summary はその renderer のメインスレッドだけを集計し、重なった区間を二重計上せず、JavaScript・GC・スタイル/レイアウト・描画・その他/フレーム待ちに分けます。GPU・compositor の処理時間は含みません。トレースは採取負荷を伴う1回分なので、平均時間や改善率の比較には bench の統計を使ってください。

## DBと通知

- 新しい環境の構築、Auth、SMTP、Edge Function の配置は [Supabase 環境の構築手順](supabase-setup.md) を参照してください。
- 既存環境への SQL 適用順とリリースの検証コマンドは [リリース前検証](release-readiness.md) を参照してください。アプリのビルド・配布だけでは本番 DB と Edge Function は更新されません。
- CIのDB検証ジョブは、新規構築・移行後の両DBで実Auth/APIの13項目とZAP Automation Frameworkを必須実行します。[要件と証跡](security-verification.md#ciの必須セキュリティ要件)を参照してください。MFAや本番設定などの未検証範囲は、合格した要件と区別して記録します。
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
