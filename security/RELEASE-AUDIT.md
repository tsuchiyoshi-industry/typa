# リリース前セキュリティ監査・問題管理

監査日: 2026-10-05（日本時間）。対象: TYPA 0.6.0（初回監査0.5.5から追補）、Solid.js / Tauri 2、ドメイン層・アプリケーション層、Supabaseアクセス実装、Rust IPC、配布設定、CI。

**現時点の判定はリリース保留。単体テストの合格だけで、人事評価データの機密性・完全性を保証できない。** 下記の未解決事項についてサーバー側の実装と実環境での証跡が必要。本番DB、実メール、実社員データへの操作は実施していない。

## 問題一覧

重大度は業務影響・到達条件からの監査上の評価。CVSSの独自算出ではない。「修正済み」はこの変更内のコード対策を指し、本番環境での解消を意味しない。

| ID | 重大度 | 状態 | 問題・根拠 | 必要な対策・完了条件 |
| --- | --- | --- | --- | --- |
| SEC-001 | Critical（受容対象） | 利用者によるリスク受容、SMTPビルド抑止撤去 | 通知専用のITサポート部門メールアカウントを使い、メールサーバーで定期的にパスワードを更新する運用を前提に、配布アプリから認証情報が取得され得るリスクを利用者が明示的に受容した（2026-10-05）。Rustで直接SMTP送信を継続。 | GitHub Secretsでビルドへ渡す。パスワード更新時はアプリも更新配布する。受容責任者・有効期限・送信権限の実設定は社内運用記録で管理する。SMTPだけを例外とし、Supabase管理キー等の拒否は維持。 |
| SEC-002 | Critical（DB設定次第） | 未確認、配布前必須 | クライアントがSupabaseテーブルへ直接アクセスする。RLS、GRANT、トリガー、RPCのバージョン管理された定義がない。`tables.md` は列定義であり認可の証拠にならない。各リクエストの `currentEmployeeId` はクライアント入力であり信頼境界にならない。 | `auth.uid()` から社員をサーバー側で解決する。各テーブルの行・列・操作・状態遷移を制約する。匿名・本人・一次・二次・無関係者でRESTを直接呼び、禁止操作の失敗とDB不変を確認する。 |
| SEC-003 | High | 未解決、配布前必須 | `LoginView` のメールドメイン制限はUIの `endsWith` 判定だけ。OTP成功後に任意入力の社員番号とユーザーIDで `employees.user_id` を更新する。メールの所有確認は社員番号の所有確認にならない。 | 招待・人事が登録したメールとの照合・会社SSOなどで社員本人を検証し、紐付けはサーバー側で一意に行う。他人の未登録番号の横取り、user metadataの改ざん、直接Auth API登録を拒否する。 |
| SEC-004 | High | アプリ側修正済み、DB側未確認 | `FetchEvaluationSheetInteractor` が無関係者にもDTOを生成し、DTOには一次評価者が閲覧できない二次総評・集計・最終ランクが残っていた。本人向け共通評価集計も漏れていた。 | シート閲覧ポリシーとDTOマスクを追加。非公開点数は `null`、総評は空文字、非公開ランクは省略。サーバーでも非公開列を返さないことが必要。RLSは行単位なので、同じ行の一次/二次列を単独では隠せない。 |
| SEC-005 | High | アプリ側修正済み、DB側未確認 | `UpdateMilestoneInteractor` はシートで認可した後、別シートの目標IDでも更新できた。本文と点数の混在リクエストで、後段の権限エラー前に本文が保存される経路もあった。 | 子IDとシートの一致・全リクエストの検証を最初の書き込み前に実施。別ID・混在攻撃でRepositoryの書き込みが0回になる回帰テストを追加。DBも同じ帰属と状態を強制する。 |
| SEC-006 | High | 未解決、配布前必須 | シート更新→評価保存→合計更新は複数リクエスト。確定チェックと更新の間に競合がある。READMEも複合UNIQUE制約なしの検索→insertを明示している。 | DBトランザクション/RPC、状態を条件に含む更新または行ロック、複合UNIQUE制約、点数CHECK、サーバーでの集計を導入。二重作成・並列保存・確定後更新を競合テストする。 |
| SEC-007 | High | コード対策追加、実WebView未検証 | 本番CSPが `null`。未使用のopener/upload/fs権限をmainウィンドウへ付与していた。カスタムPDFコマンドは任意パスへのディレクトリ作成と書き込みを許可していた。 | CSPを有効化し、Supabase接続先を明示。mainのプラグイン権限を保存ダイアログに限定。PDFは絶対パス・PDF拡張子・親参照なし・FsScope許可を検証。実WebViewでログイン、PDFダイアログ、更新を確認する。 |
| SEC-008 | Medium | アプリ側修正済み、DB側未確認 | 点数が保存前に検証されず、共通評価の未知項目/重複や要求された別等級での読取が可能だった。不明な状態文字列は下書きへ正規化されていた。 | 目標0〜4の整数、共通評価はマスタ配点以内の整数、未知/重複項目拒否、等級はシート本人から取得。不明な状態は例外。自分が自分の評価者という異常データでも自己採点・自己確定を拒否。 |
| SEC-009 | High | 依存修正、cargo audit合格 | Typst→hayagriva→citationberg→quick-xml 0.38.4がRUSTSEC-2026-0194 / 0195に該当。citationberg上流の修正コミット8966cf7c178b38b621d297c9eb6d0bb81e14be5eへCargo patchを固定し、quick-xml 0.41.0へ更新。 | 脆弱性のignoreは使用していない。citationbergの修正がcrates.ioで公開されたらpatchを外して正式版へ更新する。PDF生成テストで互換性を検証する。 |
| SEC-010 | Medium | JS依存修正済み | `bun audit` はBabel、Browserslist、baseline-browser-mappingの既知脆弱性を検出。ビルドツールの依存も検査対象。 | Babel 7.29.6、Browserslist 4.29.3、baseline-browser-mapping 2.11.27へoverridesで固定。最終`bun audit --json`は空。必要な更新を既存のユーザーによる依存更新に重ね、lockfileを更新。 |
| SEC-011 | Medium | 未確認 | 更新署名設定は存在するが、Windowsコード署名、署名鍵の管理、配布物の検証、復旧手順の証跡がない。CIは以前テストなしで配布していた。 | 型検査・カバレッジ・Rustテストを配布前に必須化済み。署名検証失敗時の更新拒否、インストーラー署名、改ざん検知、鍵の保管・失効・更新失敗からの復旧を実配布物で検証する。 |
| SEC-012 | Medium | 未確認 | 業務変更のサーバー監査ログ、評価確定の否認防止、保管期限、バックアップ復元、退職者のセッション失効をこのリポジトリでは確認できない。 | サーバーで実行者・対象・変更項目・結果・時刻を追記型ログへ保存。パスワード/トークン/不要な評価本文をログへ出さない。保存期間・アクセス権・復元目標を定め、復旧試験する。 |
| SEC-013 | Medium | アプリ側修正済み | 目標本文の部分更新で未指定欄が空文字に置き換わった。目標一覧のDB読取エラーが空一覧になり、集計をゼロで上書きする経路があった。 | 未指定欄は既存値を保持し、明示的な空文字だけクリアする。読取失敗を伝播し、合計更新を実行しない。双方に回帰テストを追加。複数リクエスト全体の原子性はSEC-006に残る。 |

## 単体テストと検証範囲

ドメイン全実装・全15ユースケース・DTOマッパーを対象に、型付き `vi.fn<Repository[method]>()` をDIする。ケースごとに新しいモックを作成し、`clearMocks` / `restoreMocks` を有効化した。実DB・実SMTP・実社員データは不要。

- 本人/一次/二次/無関係/未認証 × 下書き/提出/確定の認可マトリクス。
- 拒否された操作で書き込み・通知・PDF生成・個人情報のpresentが起きないこと。
- 他シートID、点数境界値、NaN/Infinity/小数、未知/重複項目、不完全ランク、非公開の集計からの推測防止。
- 合計と20/80配点、空データ、値オブジェクト、元エンティティを変更しない更新。
- Repository失敗・保存キャンセル・PDF失敗・メール失敗。メール失敗で保存済み確定が取り消されたと誤表示しないこと。
- PDFのTauri依存を `SheetPdfGateway` とインフラ実装へ分離。公式 `mockIPC` / `clearMocks` で実`invoke`の引数・拒否を検証。
- Rustは `tauri::test` のMockRuntimeによるIPC拒否、FsScope、Typst文字列の扱い、伏せ字入りPDF生成を用意。
- カバレッジ対象には未importの実装も含める。型のみのRepository/port/DTO定義とテストを除く。閾値は行/文/関数90%、分岐85%。これはドメイン・アプリケーションの指標であり、Solidビュー/全インフラ/Rust/DBの総合カバレッジではない。

実行:

```powershell
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run test:coverage
bun run test:rust
bun audit --json
cargo audit --file src-tauri/Cargo.lock
```

HTMLカバレッジは `coverage/index.html`。SMTPパスワードは明示的なリスク受容により公開環境変数の拒否対象から除外した。他の秘密鍵・サービスキー等の拒否は維持。Supabase URLはHTTPSかつ本番CSPの明示originと一致させる。接続先を変えるときは `csp` と `devCsp` の両方を変更する。アップデータ通信はRustプラグイン側で行われる。

一覧DTOはシートごとの二次評価閲覧権限を解決していないため、レガシー `totalScore` を全閲覧者に `null` として返す。PDFテンプレートで使っていないレガシー `totalScore` は出力DTO/Rust入力から除去した。生のREST応答の非公開化は引き続きDB側で必要。

## DB・認証の追加検証

まずステージングで [rls-inventory.sql](rls-inventory.sql) の読み取り専用結果を採取し、SQLマイグレーションとして認可・制約を管理する。RLS有効フラグだけで完了としない。

| 試験 | 必要な期待結果 |
| --- | --- |
| anonymous / 無関係社員で各テーブルを直接SELECT・UPDATE | 人事データを返さず、変更しない。テストはHTTPコードだけでなく応答列・対象行不変も確認する。 |
| 一次評価者で二次評価列、総評、ランク、派生集計を取得 | サーバー応答に非公開値が含まれない。別ビュー/RPC/列分離などで実現し、`select(*)`による迂回も拒否。 |
| 本人で共通評価・ランク・評価者コメントを取得/更新 | 非公開列を返さず、採点できない。目標の二次点数は既存ポリシーどおり本人に公開。 |
| リクエストの社員ID/目標ID/シートID/等級/評価者種別を偽造 | JWTに紐付く社員の権限以外は行使できず、他の対象へ書き込まない。 |
| Reviewerが自分を任意社員の評価者へ設定 | 会社の人事承認範囲に従う。現実装ではReviewerが社員番号で部下を設定できるため、全社員の評価者へ自己昇格できないか業務ルールを確認する。 |
| 他人の未紐付け社員番号でサインアップ、ドメイン類似メール/外部メールで直接Auth APIを呼ぶ | 本人確認なしの社員紐付けを拒否。匿名UIの有効/無効は認可証拠にしない。 |
| 確定と採点保存を並列実行、確定後に直接更新 | 原子的に許可/拒否し、確定後のデータは不変。DB集計と明細が一致。 |
| 同じ評価期間/社員/目標番号/共通項目を同時作成 | 重複行が作られず、一意制約によって同じ結果となる。 |
| 確定通知を繰り返し/偽造して呼ぶ | サーバーで認証・状態・宛先を固定し、冪等化。クライアントの総評や宛先を信用しない。 |
| 無効トークン・失効トークン・退職者トークン | 人事APIを利用できない。セッション更新・端末保管方式もレビューする。 |

## 実アプリのリリース試験

単体モックは実WebViewのCSP、Tauri ACL、ダイアログのFsScope追加、Windows署名を実行しない。Windowsで実Tauriバイナリを起動し、認証→ロール別シート表示→提出→一次/二次評価→確定→PDF→アップデートまでを合成データで試験する。PDFの伏せ字、保存キャンセル、拒否された拡張子/パスも確認する。

公式の現在のWebDriver推奨はWebdriverIO + `@wdio/tauri-service`。embedded方式には任意プラグインが必要で、従来の外部`tauri-driver`はWindows/Linux向け。テスト用サーバー/IPC操作プラグインを公式配布バイナリに含めない。今回、デスクトップE2Eは実装・実行していない。

Rust依存監査の情報警告8件は、未保守6クレート、`glib 0.18.5`のunsoundness、yanked `yoke-derive 0.8.3`。ターゲット別の到達性と上流の対応を確認し、今回のWindows試験だけで他OSも合格としない。

配布ワークフローでは `bun audit` と `cargo audit` も実行する。quick-xml脆弱性2件は上流修正により解消し、ignore設定は追加していない。

## 今回の検証結果

| 検証 | 結果 |
| --- | --- |
| Vitest | 14ファイル、235件合格。外部サービスや実メールは使用しない。 |
| ドメイン・アプリケーションのV8カバレッジ | 行99.4%、文99.41%、分岐95.92%、関数100%。閾値合格。 |
| TypeScript | アプリとVite/Vitest設定の両方の型検査が合格。 |
| Rust | `bun run test:rust`で4件合格。IPC拒否、保存先scope、文字列入力、PDF生成を確認。WindowsのCommon Controls manifestをリンカーで一度だけ埋め込み、ライブラリ・バイナリ両方のテストが起動した。 |
| フォーマット | 変更対象のBiome検査、`cargo fmt --check`、`git diff --check`が合格。 |
| JS依存監査 | `bun audit --json`は検出0件。 |
| Rust依存監査 | quick-xml更新後は終了コード0、脆弱性エラーなし。未保守等の情報警告8件は残る。 |
| フロント本番ビルド | SMTP拒否撤去後の本番ビルドを検証。認証情報を監査ログへ出力していない。 |
| 未実施 | 実WebView/E2E、ステージングDBでの認可・競合試験、インストーラー/更新の署名検証、本番運用監査。 |

## 参照した公式仕様

- [citationberg固定コミット](https://github.com/typst/citationberg/tree/8966cf7c178b38b621d297c9eb6d0bb81e14be5e): quick-xml 0.41.0を使用する上流実装。
- [Supabase User Management](https://supabase.com/docs/guides/auth/managing-user-data): Authスキーマは自動生成APIに公開されない。必要なユーザーデータは適切な権限を持つpublicテーブル等から取得する。
- [Vitest mocking](https://vitest.dev/guide/mocking.html): DIモックと状態のリセット。
- [Vitest coverage](https://vitest.dev/guide/coverage.html): V8 provider、対象include、閾値。`@vitest/coverage-v8`はVitestと同じ5.0.3を指定。
- [Tauri Mock APIs](https://v2.tauri.app/develop/tests/mocking/): `mockIPC`と`clearMocks`。
- [Tauri Rust test module](https://docs.rs/tauri/latest/tauri/test/index.html): `test` featureとMockRuntime。このAPIはunstableなので、Rust lockfileを固定し更新時に再検証する。
- [Tauri Windowsテストの既知問題](https://github.com/tauri-apps/tauri/issues/13419): Common Controls v6のmanifestがないテストは起動前に失敗する。標準と同じ依存をリンカーで埋め込み、Tauriリソース側のmanifestは無効化して二重化を防ぐ。
- [Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/): 実バイナリのE2Eとrenderer-onlyテストの違い。
- [Tauri CSP](https://v2.tauri.app/security/csp/) / [Dialog API](https://v2.tauri.app/reference/javascript/dialog/): CSPと保存先のscope。
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): exposed schemaにおけるRLSと認証主体。
- [Vite env](https://vite.dev/guide/env-and-mode): VITE変数はクライアント公開用。
- [Babel advisory](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8) / [Browserslist advisory](https://github.com/advisories/GHSA-c83g-rgw3-j3cx)。
- [RUSTSEC-2026-0194](https://rustsec.org/advisories/RUSTSEC-2026-0194.html) / [RUSTSEC-2026-0195](https://rustsec.org/advisories/RUSTSEC-2026-0195.html)。

## 評価者への通知仕様（2026-10-05追補）

登録メールは `auth.users.email` に保存される。OTP確認後の `linkUserToEmployee` は `employees.user_id` を更新し、社員とAuthユーザーを紐付ける。employeesのemail列は追加しない。固定宛先 `VITE_SHEET_FINALIZED_NOTIFY_TO` は廃止し、GitHub workflowからも削除した。

二次評価確定後、一次・二次評価者の認証済み登録メールに別々に送信する。同一メールは大文字小文字・前後空白を正規化して1通にまとめる。片方が未登録・未認証・送信失敗でも他方は送信を試みる。通知の失敗は確定済みデータを戻さず、画面に通知警告を表示する。自動再送はない。提出時・一次評価完了時の通知は追加していない。

`supabase/migrations/202610050001_evaluation_notification_recipients.sql` のDB関数は `auth.uid()` が対象社員の二次評価者に紐付くこと、本人による自己評価でないこと、シートが確定済みであることを確認してから2名のメールだけを返す。匿名実行は禁止。Authスキーマや管理キーをクライアントに公開しない。社員紐付けの既存RLS等はSEC-002/003の追加確認対象のまま。

SQLマイグレーションはPGliteのインメモリPostgreSQLで実行し、模擬Authユーザーと社員データで権限・匿名/本人/一次/無関係者拒否・確定前拒否・メール未認証・未割当・同一評価者・自己評価・再適用を検証した。SMTPはTauri公式mockIPCで検証し、実メールは送っていない。PGliteは開発依存のみ。実Supabaseへのマイグレーション適用は未実施。配布前にステージングで実際のAuth/RLS設定と合わせて検証し適用する必要がある。
