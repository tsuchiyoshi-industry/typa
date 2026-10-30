# Web 版（Cloudflare Pages）

TYPA はブラウザでも使えます。Windows のデスクトップ版と同じ Supabase につながり、同じアカウントで両方を使えます。Chromebook などデスクトップ版を入れられない端末は、こちらを使います。

- URL：[https://typa.tyco.co.jp](https://typa.tyco.co.jp)
- 置き場所：Cloudflare Pages のプロジェクト `typa`（Direct Upload）
- 公開：リリース（[release.yml](../.github/workflows/release.yml)）の `deploy-web` ジョブ

## デスクトップ版との違い

| 項目         | Web 版                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------- |
| 更新         | 公開した時点で全員が新しい版になる。更新のお知らせは出ない                                  |
| PDF          | デスクトップ版と同じ Typst のテンプレートを WASM で組み、ダウンロードする。保存先は選ばない |
| CSV          | ダウンロードする。保存先は選ばない                                                          |
| 未保存の入力 | 画面内の移動は同じ確認画面。タブやブラウザを閉じるときは、ブラウザ標準の確認が出る          |
| 二重に開く   | 止めない（タブごとに別の画面）                                                              |

## 初回の構築（1回だけ）

1. **Pages のプロジェクトを作ります。** Cloudflare のダッシュボードの **Workers & Pages** → **Create** → **Pages** で、Direct Upload のプロジェクトを `typa` という名前で作ります。本番のブランチは `main` です。コマンドなら次のとおりです。

   ```sh
   bunx wrangler pages project create typa --production-branch=main
   ```

2. **API トークンを作ります。** **Account API tokens** → **Create Token** → **Custom Token** で、権限を _Account_ / _Cloudflare Pages_ / _Edit_ にします。
3. **GitHub の Secrets に登録します。** リポジトリの **Settings** → **Secrets and variables** → **Actions** に、次の2つを足します。`VITE_SUPABASE_URL`・`VITE_SUPABASE_PUBLISHABLE_KEY` はデスクトップ版のものをそのまま使います。

   | Secret                  | 中身                                                           |
   | ----------------------- | -------------------------------------------------------------- |
   | `CLOUDFLARE_API_TOKEN`  | 2 で作ったトークン                                             |
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare のアカウント ID（ダッシュボードの概要の右側にある） |

4. **リリースを1回流します。** `deploy-web` が終わると `https://typa.pages.dev`（名前が使われていれば、ダッシュボードに出る別の名前）で開けます。ログインと PDF 出力を確かめます。
5. **独自ドメインをつなぎます。** Pages のプロジェクトの **Custom domains** → **Set up a custom domain** に `typa.tyco.co.jp` を入れます。**先にここで登録してから**、`tyco.co.jp` の DNS（Cloudflare の外で管理）に CNAME を足します。向け先は GitHub ではなく Pages です。

   ```text
   typa.tyco.co.jp. 3600 IN CNAME typa.pages.dev.
   ```

   ダッシュボードの表示が **Active** になると、証明書も自動で出て HTTPS で開けます。
6. **Supabase に URL を足します。** **Authentication** → **URL Configuration** の **Site URL**・**Redirect URLs** に `https://typa.tyco.co.jp` を足します。

## 公開の流れ

リリースを流すと、デスクトップ版の GitHub Releases が公開されたあとに、同じコミットの Web 版を Cloudflare Pages に出します。

- **DB のマイグレーションは、リリースより前に当てておきます。** デスクトップ版は利用者が更新するまで古い版が残りますが、Web 版は公開した瞬間に全員が新しい版になります。
- 公開した版に問題があれば、ダッシュボードの **Deployments** から前の版を選んで **Rollback** します。DB は戻らないので、マイグレーションを伴う版では注意します。

## セキュリティ

- ヘッダーは [public/_headers](../public/_headers) にあります。CSP はデスクトップ版と同じ範囲（自分自身と Supabase だけにつなぐ）に、PDF の WASM のための `'wasm-unsafe-eval'` を足したものです。ほかのサイトの枠（iframe）に入れることは禁止しています。`src/test/security/WebHostingHeaders.test.ts` が、デスクトップ版の接続先とずれていないかを確かめます。
- インラインのスクリプトは CSP で止まるので、`index.html` に書きません（テーマの切り替えは `public/theme.js`）。
- **共有 PC では、ブラウザにパスワードを保存させないでください。** 次に使う人がそのままログインできてしまいます。デスクトップ版は自動入力を切ってありますが、ブラウザは画面側から止めきれません。Chrome なら管理用のポリシー `PasswordManagerEnabled` を無効にするのが確実です。使い終わったらログアウトするよう案内します。

## 困ったとき

| 症状                                               | 原因と対処                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| PDF 出力で「PDFの部品を読み込めませんでした(404)」 | `dist/typa-pdf.wasm.gz` がない。`bun run build:web`（`build:pdf-wasm` を含む）でビルドしたか確かめる                |
| 画面の URL を直接開く・再読み込みすると 404        | `dist/404.html` がある。Pages は `404.html` がないときだけ、知らない URL を `index.html` に回す                     |
| 画面が真っ白で、コンソールに CSP の違反が出る      | 接続先を変えたのに `public/_headers` の `connect-src` を直していない。`src-tauri/tauri.conf.json` の CSP と合わせる |
