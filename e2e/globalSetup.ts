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
		throw new Error("Could not prepare the e2e database. Is local Supabase running?");
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

	// 冷えた Vite は初回に依存の最適化で数十秒かかり、CI では最初のテストが時間切れになる。
	// テストの前に一度ログイン画面まで開いて、最適化と再読み込みを済ませておく
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		await page.goto(`http://localhost:${E2E_PORT}/login`, { timeout: 120_000 });
		await page.getByLabel("社員番号").waitFor({ timeout: 120_000 });
	} finally {
		await browser.close();
	}

	return async () => {
		await vite.close();
		await api.stop();
	};
}
