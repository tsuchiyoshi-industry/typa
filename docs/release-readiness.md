# 2026-10-16 リリース前検証

対象は 0.9.12 作業版。既存29本の SQL と Git の変更経緯を読み、既存マイグレーションを書き換えず、3本を追加した。共有メール・共有 PC の利用、既存ログイン、確定済み評価の保存を維持する。

## 修正内容と理由

| 問題 | 対応 |
| --- | --- |
| 会社メールを受信できれば他社員の未登録番号を取得できた | Admin が社員別に招待コードを発行。7日・1回限り、再発行で旧コードを無効化。メール認証も併用 |
| 登録取り消し後に退職者が再登録できた | `is_enabled` による利用停止を追加。既存 JWT の DB 権限も拒否し、再登録も拒否。履歴とアカウントは保存 |
| 未登録・無効な Admin も「最後の Admin」の数に入った | 有効・登録済み・Auth アカウントありで判定。並行操作を直列化 |
| Reviewer が自分を他社員の評価者に変更できた | 評価者変更は Admin のみ。Reviewer の一覧・評価構造・担当評価は維持 |
| 確定時の一部集計をクライアントが選べた。保存と確定が競合した | DB が全集計・配点・ランクを計算。状態遷移と同一トランザクションで固定。目標・共通評価は同じ親シートをロック |
| 点数保存ごとに余分な集計の保存があった | 未確定は読取時に計算し、確定値だけ DB で保存。共通評価は1リクエストで保存 |
| 通知の繰り返し送信を制限できなかった | 遷移ごとの送信記録・同時実行の排除・成功済み重複排除・失敗時の手動再送・回数制限 |
| SMTP エラーに内部情報が含まれる可能性 | 利用者には汎用的な再送案内。TLS 必須、時間制限、ファイル・URL の読取禁止 |
| 既知の依存脆弱性 | rustls 0.23.46、Nodemailer 10.1.1 に更新。Edge 依存も固定して監査 |
| タグとアプリ内部バージョンが不一致でも配布できた | package.json・Tauri・Cargo.toml・Cargo.lock の一致、既存タグの HEAD 一致、署名ファイルの存在を配布前に確認 |
| 更新ダウンロード中の編集がインストールで失われ得た | ダウンロード後、インストール直前に未保存を確認。キャンセル時は作業を継続できる |
| 空 DB で Auth フックのスキーマ権限が不足した | `supabase_auth_admin` の public USAGE とフック EXECUTE を明示 |

社員変更と状態遷移は `security_audit_log` に記録する。Admin のみ SELECT 可。招待コード・メールアドレス・パスワードは含めない。通知の記録はサービス側だけが読み書きする。

## マイグレーションの経緯

- baseline は既存環境の構造を再現する出発点。社員削除で評価履歴が連鎖削除されるため、停止に DELETE を使わない。
- 20261007〜08 は受け持ち評価・一次／二次の段階・シート上の評価者・一意制約を整備した。
- 20261012 のアクセス制御は旧アプリとの互換性のため2段階。`202610120010` で古い SMTP RPC と機微な列の直接読取を廃止した。この過去の適用順は基本設計書13.3に残している。
- 20261013 はログイン保持を社員ごとに指定した。これはセッションの保存場所を決める設定であり、利用停止とは別。
- 202610160001 は招待・停止・管理権限・監査、0002 は確定集計と競合制御、0003 は通知の送信記録と再送制限。確定済みの過去評価を再計算しない。

## 既存環境への適用順

1. DB 全体と Auth 設定をバックアップし、復元できることを確認する。
2. `202610130001` まで適用済みであることを確認し、`202610160001` → `0002` → `0003` を順に、エラー時停止で適用する。登録途中の旧トークンは無効になる。旧アプリの新規登録は止まるため、アプリ更新と同じ作業枠で実施する。既存利用者のログインは維持する。
3. Auth の Before User Created を `public.hook_before_user_created` に設定する。ローカルは config.toml の設定が有効になるよう再起動する。既存 DB に baseline を再適用しない。
4. Edge Function `notify-sheet` を配置する。`deno.json` と `deno.lock` も含め、依存を固定する。
5. 対応アプリを配布する。Admin の社員マスタから未登録の社員の招待コードを発行し、本人に渡す。最初の Admin の招待だけは [環境構築手順](supabase-setup.md#27-最初の-admin-が設定する) の SQL を使う。
6. テスト用社員で登録・提出・一次／二次評価・PDF・通知の送達を確認し、[schema-inventory.sql](../security/schema-inventory.sql) の結果を期待値と比較する。

招待コードは発行直後だけ表示する。紛失したら再発行し、共有一覧やログには貼らない。パスワード忘れは登録取消→招待発行、退職は無効化。本人へのコードの受け渡しは管理者が行う。

## 再現可能な検証

2026-10-16 のローカル結果:

- TypeScript 685件（59ファイル）、Rust 5件、SMTP 実通信3件が合格。ドメイン・ユースケースの行カバレッジ98.84%、分岐96.34%。
- 空 DB と旧スキーマ更新の両経路で、実 PostgreSQL・Auth・PostgREST・通知 HTTP の検証が合格。保存と確定の競合では、確定後に待機中の目標・共通評価を書き換えられないことも確認。
- 型検査、Biome、リリースバージョン一致、Git 差分の空白検査が合格。Bun の監査はフロント・Edge とも脆弱性0件。
- `tauri build --no-bundle` で Windows ネイティブアプリをビルド。接続キーには検証用のダミーを使用しており、この exe は配布用ではない。署名付きインストーラーは作成・公開していない。
- 開発 DB に追加3本を適用し、Auth フックを有効にして再起動。社員142件・シート366件を維持し、375行のスキーマ点検結果が空 DB と完全一致。ローカル Edge Runtime で未認証呼出の401も確認。
- 適用前の全件バックアップは、Git 管理対象外の `supabase/.temp/release-check/before-release-hardening.dump` に保存。

```powershell
bun run typecheck
bun run test:coverage
bun run test:rust --release
bun audit
bun install --cwd supabase/functions/notify-sheet --frozen-lockfile --ignore-scripts
bun audit --cwd supabase/functions/notify-sheet
deno check --config supabase/functions/notify-sheet/deno.json --frozen supabase/functions/notify-sheet/index.ts
$env:OPENSSL_BIN = 'C:/Program Files/Git/usr/bin/openssl.exe'
deno test --allow-all --config supabase/functions/notify-sheet/deno.json --frozen supabase/functions/notify-sheet/smtp.test.ts
cargo audit --file src-tauri/Cargo.lock
```

Docker のローカル Supabase（`supabase_db_typa` など）が起動している状態で、以下を実行する。スクリプトは接続先を `typa_release_fresh` と `typa_release_verify` に限定し、既存の開発 DB を変更しない。検証 DB が存在するときだけ `prepareReleaseDb.ts` に `--replace` を付ける。API テストには Deno も必要。

```powershell
bun scripts/prepareReleaseDb.ts typa_release_fresh
bun scripts/verifyReleaseDb.ts typa_release_fresh
bun scripts/verifyReleaseApi.ts typa_release_fresh
bun scripts/prepareReleaseDb.ts typa_release_verify
bun scripts/verifyReleaseDb.ts typa_release_verify
bun scripts/verifyReleaseApi.ts typa_release_verify
```

fresh は全 SQL を最初から適用する。verify は旧スキーマに合成の確定済み履歴を作ってから更新し、値が変わらないことを確認する。PostgreSQL では保存と確定の並行実行、確定後の更新拒否、同時 Admin 降格、停止後の JWT 拒否を実測する。API テストは実際の Auth フック・OTP 検証・アプリのリポジトリとユースケース・PostgREST・通知 HTTP を通す。OTP はローカル Auth の管理 API で発行して検証する。実メールの配送とは分け、SMTP の465・STARTTLS・平文拒否をローカルの実ソケットで検証する。

スキーマ点検の関数ハッシュは、CRLF を LF に正規化して計算する。Windows と Linux のチェックアウト差で誤検知せず、SQL 本体の変更は検出する。初回の Linux CI で見つかった差は、この正規化と期待値の再生成で修正した。

CI の database.yml でも両経路を実行する。ローカル相当のコマンドは確認したが、GitHub Actions 上の実行結果は push 後に確認する。

## 検証の限界と次の仕様候補

- 本番メールの認証情報・到達性、クラウドのバックアップ復元、Authenticode 署名はローカル検証の対象外。配布先の環境で確認する。更新用の Tauri 署名は Authenticode の代わりにはならない。
- cargo audit で既知の脆弱性は解消。Typst などの推移的依存に未保守の警告と、Linux 向け glib の健全性警告が残る。依存元の更新を追跡する。
- SMTP が受け取った後に応答が失われると、再送で重複する可能性はある。成功を記録できた通知と同時実行は排除するが、外部 SMTP との厳密な exactly-once は保証しない。
- 最終確定の訂正・差し戻し、評価対象外の社員、同じ段階での複数画面編集の競合通知は次期仕様の候補。履歴・承認権限・通知を含む設計が必要なため、今回の安全性修正には混ぜていない。
