import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { startIsolatedApi } from "./isolatedApi";

const database = process.argv[2];
if (!["typa_release_verify", "typa_release_fresh"].includes(database)) {
	throw new Error("An isolated release database is required.");
}
const { base, jwt, sql, stop } = await startIsolatedApi(database);
const temp = resolve("supabase/.temp/release-check");
mkdirSync(temp, { recursive: true });
const files: string[] = [];
let edge: ChildProcess | undefined;
const required = <T extends { data: unknown; error: unknown }>(result: T): T["data"] => {
	if (result.error) {
		throw new Error(`API call failed: ${JSON.stringify(result.error)}`);
	}
	return result.data;
};
try {
	const edgeEntry = resolve(temp, "notification-entry.ts");
	files.push(edgeEntry);
	writeFileSync(
		edgeEntry,
		`import { createNotificationBackend } from ${JSON.stringify(pathToFileURL(resolve("supabase/functions/notify-sheet/backend.ts")).href)};
import { createNotificationHandler } from ${JSON.stringify(pathToFileURL(resolve("supabase/functions/notify-sheet/handler.ts")).href)};
Deno.serve({hostname:"127.0.0.1",port:56423},createNotificationHandler(createNotificationBackend()));`,
	);
	edge = spawn(
		"deno",
		[
			"run",
			"--allow-all",
			"--config",
			resolve("supabase/functions/notify-sheet/deno.json"),
			"--frozen",
			edgeEntry,
		],
		{
			env: { ...process.env, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: jwt("service_role") },
			stdio: "ignore",
		},
	);
	for (let i = 0; i < 80; i++) {
		if (
			await fetch("http://127.0.0.1:56423", { method: "OPTIONS" })
				.then((r) => r.ok)
				.catch(() => false)
		) {
			break;
		}
		await new Promise((r) => setTimeout(r, 250));
		if (i === 79) {
			throw new Error("Isolated notification function did not start");
		}
	}
	const service = createClient(base, jwt("service_role"), {
		auth: { persistSession: false, autoRefreshToken: false },
	});
	const managementEmail = `release-management-${Date.now()}@release.example`;
	const management = required(
		await service.auth.admin.createUser({
			email: managementEmail,
			password: "ReleasePassw0rd!",
			email_confirm: true,
		}),
	).user;
	assert.ok(management);
	sql(`update public.workspace_settings set smtp_host='',smtp_user='',smtp_password='';
    update public.employees set user_id='${management.id}' where id=900001;
    delete from public.evaluation_sheets where employee_id=900008;
    insert into public.employees(id,name,employee_no,role_id,grade_id,primary_evaluator_id,secondary_evaluator_id)
    values(900008,'Release API employee','RELEASE008',(select id from public.roles where role_name='Employee'),9001,900002,900003) on conflict(id) do update set user_id=null,is_enabled=true;`);
	const evaluatorEmails = new Map<number, string>();
	for (const n of [2, 3]) {
		const email = `release-evaluator-${n}-${Date.now()}@release.example`;
		const user = required(
			await service.auth.admin.createUser({
				email,
				password: "ReleasePassw0rd!",
				email_confirm: true,
			}),
		).user;
		assert.ok(user);
		sql(`update public.employees set user_id='${user.id}' where id=${900000 + n}`);
		evaluatorEmails.set(n, email);
	}
	process.env.VITE_SUPABASE_URL = base;
	process.env.VITE_SUPABASE_PUBLISHABLE_KEY = jwt("anon");
	const { supabase } = await import("../src/infrastructure/db/supabase");
	const { SupabaseEmployeeMasterRepository } = await import(
		"../src/infrastructure/repositories/SupabaseEmployeeMasterRepository"
	);
	const { SupabaseEmployeeRepository } = await import(
		"../src/infrastructure/repositories/SupabaseEmployeeRepository"
	);
	const { SupabaseWorkspaceSettingsRepository } = await import(
		"../src/infrastructure/repositories/SupabaseWorkspaceSettingsRepository"
	);
	const { SupabaseAuthRepository } = await import(
		"../src/infrastructure/auth/SupabaseAuthRepository"
	);
	const { RegisterEmployeeAccountInteractor } = await import(
		"../src/application/usecases/RegisterEmployeeAccountInteractor"
	);
	const { SignInEmployeeInteractor } = await import(
		"../src/application/usecases/SignInEmployeeInteractor"
	);
	const { SupabaseEvaluationSheetRepository } = await import(
		"../src/infrastructure/repositories/SupabaseEvaluationSheetRepository"
	);
	const { SupabaseMilestoneRepository } = await import(
		"../src/infrastructure/repositories/SupabaseMilestoneRepository"
	);
	const { SupabaseCommonEvaluationRepository } = await import(
		"../src/infrastructure/repositories/SupabaseCommonEvaluationRepository"
	);
	const { UpdateEvaluationStatusInteractor } = await import(
		"../src/application/usecases/UpdateEvaluationStatusInteractor"
	);
	const { EvaluationStatus } = await import("../src/domain/valueObjects/EvaluationStatus");
	assert.equal((supabase as unknown as { supabaseUrl: string }).supabaseUrl, base);
	required(
		await supabase.auth.signInWithPassword({
			email: managementEmail,
			password: "ReleasePassw0rd!",
		}),
	);
	console.log("API: management password login passed.");
	// 保存は送信テストに成功したときだけ。閉じたローカルのポートに送るので、外へは何も出ない
	const testNotice = (token: string, templateId = "submitted") =>
		fetch("http://127.0.0.1:56423", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				mode: "save",
				to: "test@release.example",
				templateId,
				smtp: { host: "127.0.0.1", port: 1, user: "sender@release.example", password: "synthetic" },
			}),
		});
	const adminSession = required(await supabase.auth.getSession()).session;
	assert.ok(adminSession);
	const settingsSnapshot = () =>
		sql(
			"select jsonb_build_object('smtp', (select to_jsonb(s) from public.workspace_settings s), 'deliveries', (select count(*) from public.sheet_notification_deliveries))",
		);
	const beforeTest = settingsSnapshot();
	assert.equal((await testNotice("invalid-token")).status, 401);
	assert.equal((await testNotice(adminSession.access_token, "__proto__")).status, 400);
	for (const templateId of ["submitted", "first_evaluated"]) {
		const failed = await testNotice(adminSession.access_token, templateId);
		assert.equal(failed.status, 503);
		assert.match((await failed.json()).error, /詳細: /);
	}
	sql("update public.employees set is_enabled=false where id=900001");
	try {
		assert.equal((await testNotice(adminSession.access_token)).status, 403);
	} finally {
		sql("update public.employees set is_enabled=true where id=900001");
	}
	// アプリからは、送信テストを経ずに SMTP 設定を書き換えられず、確かめていない設定でメールも選べない
	assert.equal(
		(await supabase.from("workspace_settings").update({ smtp_host: "evil.example" }).eq("id", true))
			.error?.code,
		"42501",
	);
	assert.equal(
		(
			await supabase
				.from("workspace_settings")
				.update({ notification_channel: "email" })
				.eq("id", true)
		).error?.code,
		"23514",
	);
	assert.equal(settingsSnapshot(), beforeTest);
	console.log(
		"API: SMTP save authentication, enabled Admin checks, template validation, failed test sends and direct writes left the database unchanged.",
	);
	const master = new SupabaseEmployeeMasterRepository(),
		employees = new SupabaseEmployeeRepository();
	const invitation = await master.issueInvitationByEmployeeNo("RELEASE008");
	assert.ok(invitation);
	console.log("API: management login and invitation passed.");
	const mailbox = `release-shared-${Date.now()}@release.example`;
	const link = required(
		await service.auth.admin.generateLink({ type: "magiclink", email: mailbox }),
	);
	assert.ok(link.properties?.email_otp);
	const auth = new SupabaseAuthRepository(new SupabaseWorkspaceSettingsRepository());
	let registered = "";
	const registration = new RegisterEmployeeAccountInteractor(auth, employees);
	await registration.execute(
		{
			employeeNo: "RELEASE008",
			invitationCode: "wrong",
			email: mailbox,
			verificationCode: link.properties.email_otp,
			password: "ReleasePassw0rd!",
		},
		{
			present: (r) => {
				registered = r.status;
			},
		},
	);
	assert.equal(registered, "invalid_invitation");
	await registration.execute(
		{
			employeeNo: "RELEASE008",
			invitationCode: invitation.code,
			email: mailbox,
			password: "ReleasePassw0rd!",
		},
		{
			present: (result) => {
				registered = result.status;
			},
		},
	);
	assert.equal(registered, "linked");
	console.log("API: invitation and OTP registration passed.");
	const sheets = new SupabaseEvaluationSheetRepository(),
		goals = new SupabaseMilestoneRepository(),
		common = new SupabaseCommonEvaluationRepository();
	const status = new UpdateEvaluationStatusInteractor(sheets, employees);
	const id = await sheets.createOrGetSheet(900001, 900008);
	await goals.upsertText(id, 1, "Synthetic API goal", "", "");
	await status.execute(
		{ sheetId: id, status: EvaluationStatus.SUBMITTED, currentEmployeeId: 900008 },
		{ present: () => {} },
	);
	const evaluatorSession = async (n: number) => {
		const email = evaluatorEmails.get(n);
		assert.ok(email);
		return required(
			await supabase.auth.signInWithPassword({
				email,
				password: "ReleasePassw0rd!",
			}),
		);
	};
	const session = required(await supabase.auth.getSession()).session;
	assert.ok(session);
	assert.equal((await testNotice(session.access_token)).status, 403);
	const notice = (token: string) =>
		fetch("http://127.0.0.1:56423", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({ sheetId: id }),
		});
	assert.equal((await notice("invalid-token")).status, 401);
	const deliveries = () => sql("select count(*) from public.sheet_notification_deliveries");
	// 既定はアプリ内通知: メールは送らず、送信の記録も残さない
	const recorded = deliveries();
	const inApp = await notice(session.access_token);
	assert.equal(inApp.status, 200);
	assert.deepEqual(await inApp.json(), { deliveries: [] });
	assert.equal(deliveries(), recorded);
	// 本人にはアプリ内通知は見えない
	assert.deepEqual(required(await supabase.from("notifications").select("id")), []);
	// メールのとき: 未設定の SMTP は記録して失敗し、続けての依頼は待たせる
	sql("update public.workspace_settings set smtp_verified_at=now(), notification_channel='email'");
	try {
		assert.equal((await notice(session.access_token)).status, 409); // Missing SMTP: tracked failure, no external send.
		assert.equal((await notice(session.access_token)).status, 429); // A second request is rate limited.
	} finally {
		sql(
			"update public.workspace_settings set notification_channel='in_app', smtp_verified_at=null",
		);
	}
	console.log(
		"API: subject submission, in-app default without mail, and real notification HTTP authorization/cooldown passed.",
	);
	const reviewerSession = (await evaluatorSession(2)).session;
	assert.ok(reviewerSession);
	assert.equal((await testNotice(reviewerSession.access_token)).status, 403);
	// 一次評価者には、提出と同時にアプリ内通知が届いている。既読にできる
	const waiting = required(
		await supabase.from("notifications").select("id,sheet_id,kind,read_at").eq("sheet_id", id),
	) as { id: number; sheet_id: number; kind: string; read_at: string | null }[];
	assert.deepEqual(
		waiting.map(({ sheet_id, kind, read_at }) => ({ sheet_id, kind, read_at })),
		[{ sheet_id: id, kind: "submitted", read_at: null }],
	);
	assert.equal(
		required(
			await supabase
				.from("notifications")
				.update({ read_at: new Date().toISOString() })
				.eq("id", waiting[0].id)
				.select("id"),
		)?.length,
		1,
	);
	console.log("API: in-app notice reached the primary evaluator only and could be marked read.");
	let current = await sheets.findById(id);
	assert.ok(current);
	await goals.updateScore(current.objectives[0].id, 4);
	await common.upsertResults(
		id,
		current.commonEvaluationResults.map((item) => ({
			id: item.id,
			itemId: item.itemId,
			firstScore: 4,
			secondScore: 0,
			firstComment: "Synthetic",
		})),
		true,
		false,
	);
	await status.execute(
		{ sheetId: id, status: EvaluationStatus.FIRST_EVALUATED, currentEmployeeId: 900002 },
		{ present: () => {} },
	);
	console.log("API: first evaluation passed.");
	await evaluatorSession(3);
	current = await sheets.findById(id);
	assert.ok(current);
	await goals.updateScore(current.objectives[0].id, undefined, 3);
	await common.upsertResults(
		id,
		current.commonEvaluationResults.map((item) => ({
			id: item.id,
			itemId: item.itemId,
			firstScore: 0,
			secondScore: 3,
			firstComment: "",
		})),
		false,
		true,
	);
	await status.execute(
		{ sheetId: id, status: EvaluationStatus.FINALIZED, currentEmployeeId: 900003 },
		{ present: () => {} },
	);
	current = await sheets.findById(id);
	assert.ok(current);
	assert.equal(current.allocatedScores.totalEvaluationScore, 75);
	assert.equal(current.status.toString(), "finalized");
	assert.equal((await supabase.from("workspace_settings").select("smtp_password")).data, null);
	required(
		await supabase.auth.signInWithPassword({
			email: managementEmail,
			password: "ReleasePassw0rd!",
		}),
	);
	assert.equal(await master.updateEnabledByEmployeeNo("RELEASE008", false), true);
	await supabase.auth.signOut({ scope: "local" });
	let loginStatus = "";
	await new SignInEmployeeInteractor(auth, employees).execute(
		{ employeeNo: "RELEASE008", password: "ReleasePassw0rd!" },
		{
			present: (r) => {
				loginStatus = r.status;
			},
		},
	);
	assert.equal(loginStatus, "account_disabled");
	assert.equal(await auth.getSession(), null);
	console.log(
		`${database}: real Auth hook, emailed-code verification, invitation registration, app repositories/use cases and both evaluation stages passed through PostgREST.`,
	);
} finally {
	if (edge && edge.exitCode === null) {
		const processToStop = edge;
		const exited = new Promise<void>((resolve) => processToStop.once("exit", () => resolve()));
		processToStop.kill();
		await exited;
	}
	await stop();
	for (const file of files) {
		try {
			unlinkSync(file);
		} catch {}
	}
}
