# セキュリティ検証と未検証範囲

基準は [OWASP ASVS 5.0.0](https://asvs.owasp.org/) と [OWASP Top 10:2025](https://top10.owasp.org/2025/ja/)。要件IDは [5.0.0の固定版](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv) を参照する。これは選定した要件の回帰検証であり、ASVSのレベル認定や全項目への適合を表さない。

## CIの必須セキュリティ要件

機械可読の正本は [security/requirements.json](../security/requirements.json)。`required` の各行に要件ID、ASVSの関連番号、合格条件を定義し、[verifySecurity.ts](../scripts/verifySecurity.ts) が同じIDで実行結果を出す。未実行・失敗・重複・未知のIDがあると全体を失敗させる。ASVS番号に対応付けたテストはその要件の限定的な証拠であり、関連番号の要件全体への適合を宣言するものではない。

[DB検証ジョブ](../.github/workflows/database.yml) は従来のSQL・実Auth・UI検証に加え、新規構築の `typa_release_fresh` と移行後の `typa_release_verify` の両方に、以下の13チェックを必須で実行する。

| テストID           | 関連ASVS                 | 必須の合格条件                                                                                                                                                  |
| ------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUTH-LOGIN         | V8.3.1                   | 実パスワード認証で社員本人を特定し、保護された文書の本人用マーカーを取得できる                                                                                  |
| AUTH-ANON          | V8.2.1                   | 未認証・anonは文書取得と権限管理RPCを実行できない                                                                                                               |
| AUTH-JWT           | V9.1.1, V9.1.2, V9.2.1   | 実PostgRESTが改ざん、署名なし、期限切れ、有効期間前のJWTを401で拒否する                                                                                         |
| AUTH-UNLINKED      | V8.2.1                   | 実Authで認証済みでも社員未紐付けなら文書を取得・承認できない                                                                                                    |
| ACCESS-BOLA        | V8.2.2                   | 別社員・Admin・社員未紐付けの実トークンで本人の文書を取得・改変・確定できず、保存内容も不変                                                                     |
| ACCESS-BFLA        | V8.2.1                   | 社員とReviewerが権限変更・招待発行・特権シート操作RPCを直接呼んでも403になる                                                                                    |
| ACCESS-FIELDS      | V8.2.3                   | 本人の目標編集に不正な評価点を混ぜると全体拒否し、通常の本文更新は成功する                                                                                      |
| ACCESS-SUSPEND     | V8.3.2                   | 一度通った同じJWTをそのまま使っても、利用停止後は文書取得・承認を拒否する                                                                                       |
| FLOW-APPROVAL      | V2.3.1                   | 目標確認を飛ばした状態遷移と提出の再送を拒否し、通知が重複しない                                                                                                |
| DATA-SECRET        | V8.2.3                   | 社員もAdminもSMTPパスワードをPostgRESTから読めない                                                                                                              |
| AUDIT-ATOMIC       | V2.3.3, V16.4.2, V16.5.3 | APIから監査を偽造・削除できず、監査書込み障害時のAdminによる削除も全体ロールバックする                                                                          |
| AUTH-RATE          | V6.3.1の一部             | 同一接続元からの実password grantが80回以内に429となり、失敗応答にトークンがなく、正しいログインは20秒以内に回復する。転送IPヘッダーの偽装でも制限を回避できない |
| DAST-AUTHENTICATED | V1.2.4等の一部           | 認証付きのZAP AFが対象文書と本人IDを確認し、選定した能動検査と受動検査を完了、スキャン後も認証を確認する。Medium/Highの検出、AFの警告・エラー、証跡欠落は失敗   |

### ZAPと検証環境

プランは [security/zap/plan.yaml](../security/zap/plan.yaml)。ZAP 2.17.0のDockerイメージを [image.txt](../security/zap/image.txt) のdigestで固定する。通常社員の実パスワードログインで発行したトークンを使い、service_roleや手製JWTでスキャンしない。能動検査は隔離された `typa_release_rest:3000` の `get_sheet` / `current_employee_id` / `get_previous_goals` と目標本文のPATCHに限定する。一般的なSQL、PostgreSQL向けSQL、CRLF、パストラバーサル、サーバーコード注入の5ルールを有効化し、他の能動ルールはこのプランの対象に含めない。

認証前提はrequestorの200応答だけでなく、URLテストの本人用マーカーと本人IDで検査する。先に同じプランへ不正トークンを渡し、401とURLテストの失敗で非ゼロ終了することを必須の負の対照として確認する。正しいトークンでの能動検査は5ルールそれぞれの送信数が1以上、停止回数が0であることも統計テストで確認する。プランの警告・エラー、各スキャン10分の実行期限超過、JSONレポート未生成、対象サイト不一致、Medium以上の警告検出で失敗する。Low/Informationalはレポートに残す。タイムアウトを正常終了として扱ったり、見つかった警告を一括IGNOREしたりしない。

目標本文のPATCHは実アプリと同じ `Prefer: return=minimal` でスキャンする。PostgRESTの投影パラメーター `select=/milestones` をファイル参照とみなす誤検知があったため、HTTPテストでも当該入力を再現し、拒否されるか許可された行IDだけを返すことを確認する。パストラバーサルルール自体は有効なまま保持する。

GoTrueの送信元IP制限は、信頼できるゲートウェイがIPを渡す構成を前提にする。検証用ゲートウェイは `X-Forwarded-For` をソケットの接続元で上書きし、`Sb-Forwarded-For` を除去する。隔離GoTrueには `GOTRUE_RATE_LIMIT_HEADER=X-Forwarded-For` を明示する。レート自体をテスト用に引き下げない。**これはローカル検証用ゲートウェイの契約であり、クラウドゲートウェイの実効設定や本番との同一性の証明ではない。** Authの実効レート・パスワード・CAPTCHA・TOTP設定は秘密を除いた許可リストで証跡に記録する。

JWTの期限検査だけは、隔離環境の既知の署名鍵で期限切れ・有効期間前のJWTを生成し、署名自体が正しくても拒否されることを確認する。その他の認可テストには実Auth発行のトークンを使う。

### 証跡と説明できる範囲

`security-evidence` artifact（保持14日）にはDBごとの `results.json`、`zap.log`、`zap-report.json` と不正トークン対照の `zap-auth-negative.log` / `zap-auth-negative-report.json` を保存する。要件ごとの結果、未実装項目、コミット、プラン・要件表・検証コード・設定のSHA-256、イメージ情報、許可されたAuth設定を残す。失敗時も生成済みの証跡を保存する。JWT・refresh token・パスワードは除去し、生のレポートとトークン用envファイルはアップロード対象外に置いて終了時に削除する。

既存の集約 `test` が `database` ジョブの成功を要求し、リリースがその集約に依存する。したがってセキュリティ検証失敗時は配布へ進まない。ブランチへの直接マージも止める場合は、GitHubのルールで集約チェックを必須にする。

説明できるのは「当該コミットを、記録された隔離環境で検査し、正本の `required` の全合格条件を満たした」こと。`pending` にある分散スプレー対策、アカウント単位制御、MFAと認証迂回経路、issuer/audience、SMTP SSRF、クラウド設定差分、Tauri固有の境界は合格扱いにしない。ZAPの対象外APIも検証済みとは扱わない。

公式仕様: [AF環境と警告処理](https://www.zaproxy.org/docs/desktop/addons/automation-framework/environment/)、[requestor](https://www.zaproxy.org/docs/desktop/addons/automation-framework/job-requestor/)、[URLテスト](https://www.zaproxy.org/docs/desktop/addons/automation-framework/test-url/)、[activeScan](https://www.zaproxy.org/docs/desktop/addons/automation-framework/job-ascan/)、[終了コード](https://www.zaproxy.org/docs/desktop/addons/automation-framework/job-exitstatus/)。

## 実行する

```powershell
# 今回追加した攻撃・境界値・設定の回帰テスト（Chromiumも使用）
bun run test:security

# 既存の業務・認可・通知テストも含む全体とカバレッジ基準
bun run test:coverage
bun run typecheck
bun run check

# Docker上のローカルSupabaseと、既存手順で準備・検証済みの隔離DBが必要
bun scripts/verifySecurity.ts typa_release_fresh
bun scripts/verifySecurity.ts typa_release_verify
```

初回は `bunx playwright install chromium` が必要。テストは外部のSupabase、SMTP、本番DBへ接続しない。既存CIの `bun run test:coverage` で新規ファイルも実行されるため、専用コマンドの追加だけでCIから漏れることはない。

### テストの信頼境界

| 略号 | ファイル                                           | 検証内容と限界                                                                                                                                                                                                                                            |
| ---- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB   | `src/test/security/AuthorizationSql.test.ts`       | `createProdLikeDb()` で最新までのマイグレーションを適用。`anon` / `authenticated` のロールと別人のsubjectを使い、本物のRLS・トリガー・RPCを実行する。拒否後はDBオーナーでデータが変わっていないことも確認する。JWT検証・PostgREST・ネットワークは含まない |
| HTTP | `src/test/security/NotificationHttp.test.ts`       | 本物の通知ハンドラーへ `Request` を渡し、応答と後続処理が呼ばれないことを確認。Auth・DB・SMTPはモックであり、暗号署名や実際の認可ポリシーをこのテスト単独では証明しない                                                                                   |
| DOM  | `src/test/security/StoredContent.browser.test.tsx` | Chromiumで実際の期中目標・達成状況コンポーネントへ攻撃文字列を渡す。文字列としての保持と、攻撃用DOMノードが生成されないことを確認。全画面のXSS検査ではない                                                                                                |
| CSV  | `src/test/security/CsvInput.test.ts`               | CSV数式の無害化、ファイルの上限、形式不正、片方のファイルに誤りがある場合の全体拒否。Excel自体の実行やDB直アクセス時の負荷制限は含まない                                                                                                                  |
| 設定 | `src/test/security/DesktopConfiguration.test.ts`   | 両CSP、全capability JSON、更新用公開鍵・HTTPSを検査。配布されたWebViewの実効設定や署名検証処理そのものの実行テストではない                                                                                                                                |

DBのfixture作成時には管理者ロールを使うが、攻撃を実行する前に必ず利用者ロールへ切り替える。PGliteの `auth.uid()` / `auth.jwt()` はSupabase固有機能の代替であり、偽造JWTを受け入れられるという意味ではない。共有のPGlite接続への `Promise.all()` は本番PostgreSQLの複数接続による競合検証にはならない。

## 30項目の対応

「実行」は記載したケースを検証するという意味で、その攻撃全般への耐性を保証しない。「外部」は未検証として残す。「対象外」は現在の実装にその機構がなく、導入時に再評価するという意味。

| #   | 脅威                         | ASVS 5.0.0の関連要件・章 | 証拠 / 残る検証                                                                                                                                                                                                        |
| --- | ---------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 認証バイパス                 | V8.2.1, V8.3.1           | 実行: DBのanon・社員未紐付け、HTTPの認証拒否・例外・Bearerなし。外部: 実Auth/APIへの直接要求                                                                                                                           |
| 2   | 権限昇格                     | V8.2.1, V8.3.2           | 実行: DBでReviewer・本人・無関係社員の管理RPCを拒否。利用停止は同じsubjectのまま即時反映。既存 `EmployeeAccessHardeningSql.test.ts` は最終Adminの保護も検証                                                            |
| 3   | IDOR / BOLA                  | V8.2.2                   | 実行: DBで6状態×Admin・無関係社員・社員未紐付けの参照・更新・遷移を拒否。本人の正常な読書きも確認                                                                                                                      |
| 4   | BFLA                         | V8.2.1, V8.3.1           | 実行: DBで権限変更・停止・招待・登録解除・インポート・シート削除RPCの直接呼出しを拒否                                                                                                                                  |
| 5   | Mass Assignment              | V8.2.3                   | 実行: DBで通常の更新に権限・ユーザー紐付け・点数・親シートIDを混ぜて全体拒否。HTTPはactor・宛先・SMTP・isAdminの偽装を無視                                                                                             |
| 6   | ブルートフォース             | V6.3.1, V2.4.1           | 一部実行: DB検証ジョブのAUTH-RATEで実password grantの送信元IP制限・ヘッダー偽装・回復を確認。未検証: 分散攻撃・アカウント単位制御・本番設定。OTP・メール送信コストの制限とも別                                         |
| 7   | クレデンシャルスタッフィング | V6, V2.4.1               | 外部: Authのパスワード方針・流出パスワード対策・必要に応じたMFA・検知を確認                                                                                                                                            |
| 8   | セッションハイジャック       | V7                       | 一部実行: 既存 `src/infrastructure/db/sessionStore.test.ts` が共有PCの保存抑制とログアウト時の両ストレージ削除を検証。外部: 盗難refresh token、端末保護、サーバー側失効                                                |
| 9   | セッション固定               | V7                       | 外部: 実Authで認証前後のtoken発行、更新・再認証・ログアウト後の再利用を確認。ストレージ単体テストでは証明しない                                                                                                        |
| 10  | JWT / OAuth / OIDC検証不備   | V9, V10                  | 実行: AUTH-JWTで実PostgRESTへ改ざん・期限切れ・署名なし・有効期間前のJWTを送り401を確認。HTTPハンドラーのAuth拒否・例外も検証。未検証: 本番ゲートウェイのissuer/audience・トークン用途。OAuth/OIDCの独自フローは対象外 |
| 11  | XSS                          | V1.2.1, V3.2.2           | 実行: DOMでscript・img/onerror・SVG・iframe/srcdoc・javascript URL・DOM clobbering文字列を文字表示。設定でscript-srcを制限。外部: 他の表示経路と配布WebView                                                            |
| 12  | CSRF                         | V3.5                     | 実行: HTTPで悪意あるOrigin＋CookieだけのPOSTを拒否。現構成は明示的Bearer。外部: 実ゲートウェイ、Cookie認証を導入する場合の防御                                                                                         |
| 13  | クリックジャッキング         | V3.4                     | 設定検査のみ: Tauriのframe-srcは子フレームの制限。親による埋込みを防ぐものではない。Web公開時はレスポンスのframe-ancestors / X-Frame-Optionsを別途検証                                                                 |
| 14  | CORS設定不備                 | V3.4.2                   | 一部実行: HTTPのpreflightに副作用がなく、ワイルドカードとAllow-Credentialsを併用しない。認可はBearer＋DBで行う。外部: 公開API全体のCORSと機密レスポンス。これだけでASVS要件を充足とはしない                            |
| 15  | オープンリダイレクト         | V3.5                     | 現在の通知ハンドラーに利用者指定のリダイレクト処理はない。設定ではURLを開くnative権限を付与しない。外部: Auth側のredirect allowlist・将来のURL遷移                                                                     |
| 16  | Prototype Pollution          | V1.5.2, V2.2.1           | 実行: HTTPで `__proto__` / `constructor.prototype` 混入後もObject.prototype・認可・宛先が変わらない。依存ライブラリ全体の証明ではない                                                                                  |
| 17  | SQLインジェクション          | V1.2.4                   | 実行: DBの保存RPCへSQL・式風の攻撃文字列を渡し、取得RPCでも文字列のまま保持、権限不変を確認。不正な点数を含むJSONバッチは全体ロールバック。外部: 実PostgREST経路と他RPCの入力                                          |
| 18  | NoSQLインジェクション        | V1.2.4                   | 対象外: PostgreSQL構成でNoSQLクエリはない。HTTPのオブジェクト型sheetId拒否は入力検証として実行                                                                                                                         |
| 19  | OSコマンドインジェクション   | V1.2.5                   | Vitestでのnative処理検証は対象外。設定でshell実行権限を付与しない。Rust側・外部プロセス導入時には別途実行検証                                                                                                          |
| 20  | SSTI                         | V1.3.7                   | 一部実行: DBに式風の文字列を保存しても式評価しない。メールは既存 `NotifySheetMail.test.ts` で置換結果を再解釈しない。TypstはRust側の別検証が必要                                                                       |
| 21  | パストラバーサル             | V5                       | Vitestだけでは未検証。Rustの `pdf_destination_requires_absolute_pdf_and_dialog_scope` / `ipc_rejects_unselected_path_without_creating_a_file` が保存先・スコープを検証。`bun run test:rust --release` で実行する       |
| 22  | SSRF                         | V1.3.6                   | 外部・要対策判断: 通知宛先・SMTP設定の一般利用者による偽装はHTTPで拒否するが、Adminは任意SMTPホストを指定可能。内部IP・loopback・metadata・DNS再解決・送信先portに対するegress制御は未証明                             |
| 23  | XXE                          | V1.5.1                   | 対象外: XML解析・アップロード機能はない。CSVでXML風入力を不正形式として拒否することは実行するが、XMLパーサーのXXE耐性テストとは扱わない                                                                                |
| 24  | 安全でないデシリアライズ     | V1.5.2, V2.2.1           | 実行: HTTPでJSONのnull・配列・scalar・構造不正・型の異なるIDを拒否。コード実行型デシリアライザーは使用しない。Rustのserde境界は別途                                                                                    |
| 25  | ファイルアップロード悪用     | V5.2.1–2                 | 実行: CSVの20MiB超・形式不正・不完全な引用符・片方のみ不正でも全体拒否。ファイルの任意公開機能はない。DB直アクセスによる大量JSON入力の上限は別途確認                                                                   |
| 26  | レースコンディション         | V2.3.3–4                 | 実行: 既存DBジョブの `verifyReleaseDb.ts` が実PostgreSQLの別接続で保存と確定、最後のAdminの同時降格等を同期して検証。未検証の競合は追加が必要。PGliteの逐次実行を競合耐性の証拠にしない                                |
| 27  | 業務ロジック悪用             | V2.3.1                   | 実行: DBで目標確認を飛ばした提出・確定を拒否し、状態と通知の不変を確認。既存 `GoalConfirmationWorkflowSql.test.ts` / `SheetIntegritySql.test.ts` も利用                                                                |
| 28  | リソース枯渇 / DoS           | V2.4.1, V5.2.1           | 実行: HTTPの4096 byte許可・4097 byte拒否、UTF-8 byte数、偽Content-Length、chunked bodyの中断、CSVのサイズ上限。外部: slow body、接続数、DBコスト、PDF並列生成、実レート制限                                            |
| 29  | リプレイ攻撃                 | V2.3.1, V2.4.1           | 実行: DBで承認の再送を拒否し通知1件を確認。既存 `NotificationDeliverySql.test.ts` がclaim回転・古いclaim拒否・送信済み重複抑止を検証。外部: 同時再送・SMTP成功後の障害による重複                                       |
| 30  | ReDoS                        | V1.3.12                  | 未証明: 入力サイズ上限は一部検証するが、全正規表現の計算量や依存コードのReDoSは検証しない。計測条件を固定した別プロセス・タイムアウト付きの検査が必要                                                                  |

## 全体としての確認

| 項目             | 関連ASVS / Top 10:2025 | 証拠 / 残る検証                                                                                                                                                                                                                     |
| ---------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 機密情報漏洩     | V16.5.1 / A02, A04     | DBはAdminを含めSMTPパスワードの直接取得不可・旧RPC削除を検証。HTTPはAuth/DBエラーの内部情報・秘密を返さない。既存 `NotifySheetHandler.test.ts` はSMTP失敗応答も検証。全ログ・クラッシュダンプは別途                                 |
| 暗号化・鍵管理   | V9, V11, V12 / A04     | 設定でHTTPS更新先・公開鍵の存在、既存 `ReleaseConfiguration.test.ts` で公開ビルドへの秘密混入拒否。外部: TLS証明書、DB/SMTP秘密の保管・ローテーション・端末ストレージ・署名検証                                                     |
| セキュリティ設定 | V3.4, V13 / A02        | 両CSPと全capabilityの許可リストを実行検査。外部: Web公開時のCSP/HSTS/frame-ancestors、API gateway、実バイナリのdebug設定                                                                                                            |
| サプライチェーン | V13, V15 / A03, A08    | 既存CIにfrozen lockfile、`bun audit`、`cargo audit`、Rust・通知・DBの検査ゲートがある。Vitestの設定検査だけで依存脆弱性・CI改ざん・署名の信頼性を証明しない                                                                         |
| API過剰公開      | V8.2.3 / A01           | DBの無関係者への文書非公開、HTTPの宛先アドレス・SMTP設定非公開。既存 `GoalScoreVisibilitySql.test.ts` は最新DBで未確定点数の秘匿を検証。API全体のレスポンス一覧は別途                                                               |
| エラー処理       | V16.5.1–3 / A10        | HTTPのAuth・認可・設定読出し・claim・SMTP設定・結果記録の障害時に許可へ進まない。DBは不正JSONバッチを全体拒否。既存 `PrivilegedSheetOperationSql.test.ts` は監査書込み障害時のロールバックを検証                                    |
| 監査ログ         | V16.3, V16.4.2 / A09   | DBで利用者・評価者・Adminのログ偽造/更新/削除を拒否。既存 `EmployeeAccessHardeningSql.test.ts` / `PrivilegedSheetOperationSql.test.ts` が管理操作の記録を検証。外部: 認証失敗・認可失敗の収集、保管先分離、保持期限、通知・検知運用 |

### 今回の回帰テストで修正した箇所

- CSV出力は危険な先頭文字を持つ文字列にアポストロフィを付けてからRFC 4180の引用処理を行う。空白の後の式も対象。通常の文章と数値はそのまま。CSVをテキストとして読み直すと、このアポストロフィもデータとして残る。Excelで編集・再保存する運用は別途確認する。
- 通知APIは空や別schemeのAuthorizationをAuthへ渡さず401にする。署名・期限・利用者の実在性は従来どおりSupabase Authの `getUser(token)` が検証する。Bearerの構文検証だけを認証機構とは扱わない。

新しいAPI・CSV項目・native capability・認証方式を追加したら、対応行の適用範囲を見直し、失敗時の副作用と正常系の両方をテストへ追加する。
