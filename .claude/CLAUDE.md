# TYPA の変更チェックリスト

コードを直したら、変更の種類に応じて下の「あわせて直す場所」をすべて確かめる。コードだけ直して、テスト・セキュリティの期待値・ドキュメントが古いまま残ると、CI（とくに database ジョブ）やリリース後の運用で初めて気づくことになる。

終わったら、直した場所と「直さなかった場所とその理由」を報告する。

## すべての変更

- [ ] `bun run check`（警告も失敗）、`bun run typecheck`、`bun run test` が通る
- [ ] 大きな変更はテストを先に書く（失敗を確かめてから実装）。正常系だけでなく、権限・不正入力・失敗・競合の異常系も書く
- [ ] 画面や流れを変えたら `bun run test:e2e`。**E2E はファイル単体では流さない**（`term.spec.ts` は `evaluation.spec.ts` の後に動く前提）。全体を流す
- [ ] E2E のセレクタは役割で特定する（例: `getByRole("combobox", { name: "評価期間" })`）。`getByLabel` は直前の画面の同名ラベルを拾うことがある

## DB（マイグレーション・DB 関数）を変えたとき

- [ ] 新しいファイル `supabase/migrations/YYYYMMDDNNNN_<内容>.sql` を足す。**過去のマイグレーションは書き換えない**。`begin;` 〜 `commit;` で囲む
- [ ] DB 関数は `security definer` ＋ `set search_path = ''`。`revoke all ... from public, anon, authenticated` のあと、必要なロールにだけ `grant`
- [ ] Admin 専用の操作は、関数の中で `current_employee_is_admin()`（利用停止中の Admin も断る）を確かめ、`security_audit_log` に理由・前後の値・消した内容を残す。監査に失敗したら全体が取り消されること
- [ ] **開発用 DB にすぐ当てる**（ユーザーが `bun run dev` で同時に触っている）

  ```sh
  docker exec -i supabase_db_typa psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/<file>.sql
  docker exec supabase_db_typa psql -U postgres -d postgres -c "notify pgrst, 'reload schema'"
  ```
- [ ] SQL テスト `src/test/<名前>Sql.test.ts`（`createProdLikeDb` / `actAs`）。正常系に加えて、Admin 以外の各権限・利用停止中の Admin・不正な入力・画面で見ていた状態との食い違い（競合）・監査の失敗・RPC を通さない直接更新を、**何も変わらないこと**まで確かめる
- [ ] **セキュリティの期待値** `security/schema-inventory.expected.txt` を作り直す（関数・権限・ポリシー・トリガー・制約を変えたとき。E2E の準備と CI の database ジョブが照合する）

  ```sh
  bun scripts/prepareReleaseDb.ts typa_e2e --replace   # 照合で止まるが、DB は作られる
  docker exec -i supabase_db_typa psql -U postgres -d typa_e2e -v ON_ERROR_STOP=1 -q -At < security/schema-inventory.sql > security/schema-inventory.expected.txt
  git diff security/schema-inventory.expected.txt       # 意図した行だけが変わったか
  ```
- [ ] 新しい Admin 専用 RPC は `scripts/verifySecurity.ts` の `ACCESS-BFLA`（Admin 以外が呼べないこと）に足す。要件そのものを増やすときは `security/requirements.json` と `docs/security-verification.md` も
- [ ] JSON を返す関数（`get_sheet_overview` など）に項目を足したら、リポジトリの型（`src/domain/repositories/*`）とテストの fixture（`src/test/fixtures.ts`、`*Overview*.test.ts` など）も
- [ ] CI の database ジョブと同じ検証をローカルで流す

  ```sh
  bun scripts/prepareReleaseDb.ts typa_release_fresh --replace && bun scripts/verifyReleaseDb.ts typa_release_fresh && bun scripts/verifyReleaseApi.ts typa_release_fresh
  bun scripts/prepareReleaseDb.ts typa_release_verify --replace && bun scripts/verifyReleaseDb.ts typa_release_verify && bun scripts/verifyReleaseApi.ts typa_release_verify
  ```
- [ ] ドキュメント
  - `docs/migration-history.md` に目的と互換性を書く（**新しい順。先頭に足す**）
  - 本番へ当てる注意（配布前に適用が要る、など）を `docs/development.md` の該当節に
  - 既存環境に特別な手順（順番・同時に配置するもの）が要るなら `docs/release-readiness.md`
  - 仕様が変わるなら `docs/basic-design.md`

## 画面・操作を変えたとき

- [ ] マニュアル `docs/manual/admin.md` / `evaluator.md` / `user.md`。見出しを変えたら、ページ内リンク（`#9-...`）も直す
- [ ] アプリ内ヘルプ `src/adapter/views/HelpView.tsx` の文言
- [ ] `docs/basic-design.md` の画面一覧・権限の表
- [ ] E2E `e2e/*.spec.ts` と、マニュアルの写真を撮る `e2e/manual.shots.ts` のセレクタ
- [ ] 見た目はライト・ダーク両方で確かめる（Edge ヘッドレスで、実際の CSS を読む静的 HTML を撮る。`--user-data-dir` 必須）
- [ ] 書きかけの入力がある画面は、別の対象へ移る・画面を離れる前に確かめる（`trackUnsaved` / `confirmDiscard`）。失敗したときは入力を残す

## 権限で出し分けるとき

- [ ] 判定はドメイン層に置く（`src/domain/services/EmployeeMasterAccessService.ts`、`EmployeeProfile`、`EmployeeRole`）
- [ ] メニューを隠すだけにしない。**URL を直接開いても**コントローラかユースケースで断り、データを読まない。DB 関数・RLS でも断る
- [ ] トップバーの出し分けは `AccountController` の `CurrentUserDto` と `DashboardLayout`（と各テスト）

## 画面（ルート）・メニューを足す・消すとき

- [ ] `src/App.tsx` のルートと `protectedViews`、コントローラの組み立て
- [ ] `DashboardLayout.tsx` のナビ・ユーザーメニューと `DashboardLayout.test.tsx`
- [ ] 消すときは、そのビュー・コントローラ・テスト・CSS・マニュアルの節・ヘルプの記述まで消す

## PDF の項目を変えるとき

- [ ] `src/application/dtos/ExportSheetDto.ts`、`ExportSheetMapper.ts`、`src-tauri/src/pdf/sheet.rs`、`src-tauri/src/pdf/templates/template.typ`
- [ ] `bun run test:rust --release`

## スクリプト・CI を変えるとき

- [ ] CI は Linux（database・benchmark・release の一部）と Windows（test）の両方で動く。手元の Windows で通っても Linux で落ちることがある（Docker Desktop 前提の文言・パス・シェル）
- [ ] 失敗の判定は「本当に必要な条件」で行い、外部コマンドの出力（stderr）をエラー文に添えて、ログだけで原因が分かるようにする
- [ ] コマンドを足したら `docs/development.md` のコマンド表

## バージョンを上げるとき

- [ ] `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` をそろえる（`ReleaseVersion.test.ts` が照合する）
