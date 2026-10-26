import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { startIsolatedApi } from "../scripts/isolatedApi";
import { E2E_PORT, PASSWORD } from "./support";

// The app under test talks to real GoTrue + PostgREST on a freshly migrated, synthetic
// database (typa_e2e). The developer's own local database is never touched.
export default async function globalSetup() {
	const prepared = spawnSync("bun scripts/prepareReleaseDb.ts typa_e2e --replace", {
		stdio: "inherit",
		// Windows resolves bun's .cmd shim only through the shell.
		shell: true,
	});
	if (prepared.status !== 0) {
		throw new Error("隔離DB typa_e2e の準備に失敗しました。直前に表示された起動・検証エラーを確認してください。");
	}
	const api = await startIsolatedApi("typa_e2e");
	api.sql(readFileSync("security/release-fixture.sql", "utf8"));
	// Fixture accounts get a known password, so tests sign in through the real login form.
	api.sql(`update auth.users set
      encrypted_password=extensions.crypt('${PASSWORD}', extensions.gen_salt('bf')),
      instance_id='00000000-0000-0000-0000-000000000000',
      confirmation_token='', recovery_token='', email_change_token_new='', email_change=''
    where email like 'typa-release00%@release.example';
    insert into public.employees(id,name,employee_no,role_id,grade_id)
      values(900009,'E2E unregistered','RELEASE009',(select id from public.roles where role_name='Employee'),9001);`);

	// Environment variables already set win over .env files, so the app cannot reach
	// the developer's Supabase even with .env.development.local present.
	process.env.VITE_SUPABASE_URL = api.base;
	process.env.VITE_SUPABASE_PUBLISHABLE_KEY = api.jwt("anon");
	// Workers inherit these; tests use them only for what a person would read from email.
	process.env.E2E_API_URL = api.base;
	process.env.E2E_SERVICE_KEY = api.jwt("service_role");
	const vite = await createServer({ server: { port: E2E_PORT, strictPort: true } });
	await vite.listen();

	// CI では、起動直後の Vite で最初に開いたページだけがログイン画面を出さないまま戻らない
	// (2 枚目以降は開く)。テストの前に、開けるまでページを作り直しておく。
	// 開けなかったときはブラウザ側のエラーを残し、原因を追えるようにする
	const browser = await chromium.launch();
	try {
		for (let attempt = 1; ; attempt++) {
			const page = await browser.newPage();
			const problems: string[] = [];
			page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
			page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
			page.on("requestfailed", (r) =>
				problems.push(`failed: ${r.url()} ${r.failure()?.errorText}`),
			);
			page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()}: ${r.url()}`));
			try {
				await page.goto(`http://localhost:${E2E_PORT}/login`);
				await page.getByLabel("社員番号").waitFor({ timeout: 30_000 });
				break;
			} catch (error) {
				const body = await page.content().catch(() => "");
				console.warn(
					`Warm-up ${attempt} could not open the login page`,
					problems,
					body.slice(0, 2000),
				);
				if (attempt === 4) {
					throw error;
				}
			} finally {
				await page.close();
			}
		}
	} finally {
		await browser.close();
	}

	return async () => {
		await vite.close();
		await api.stop();
	};
}
