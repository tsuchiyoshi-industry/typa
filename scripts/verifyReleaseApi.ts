import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

// Real GoTrue + PostgREST, connected only to an explicitly isolated verification DB.
const database = process.argv[2];
if (!["typa_release_verify", "typa_release_fresh"].includes(database)) {
	throw new Error("An isolated release database is required.");
}
const docker = (...args: string[]) => {
	const result = spawnSync("docker", args, { encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(`Docker operation failed: ${args[0]}`);
	}
	return result.stdout.trim();
};
const sql = (statement: string) => {
	const result = spawnSync(
		"docker",
		[
			"exec",
			"-i",
			"supabase_db_typa",
			"psql",
			"-U",
			"postgres",
			"-d",
			database,
			"-v",
			"ON_ERROR_STOP=1",
			"-q",
			"-At",
		],
		{ input: statement, encoding: "utf8" },
	);
	if (result.status !== 0) {
		throw new Error("Isolated fixture SQL failed");
	}
	return result.stdout.trim();
};
type Container = {
	Config: { Image: string; Env: string[] };
	NetworkSettings: { Networks: Record<string, unknown> };
};
const authTemplate = JSON.parse(docker("inspect", "supabase_auth_typa"))[0] as Container;
const restTemplate = JSON.parse(docker("inspect", "supabase_rest_typa"))[0] as Container;
const authEnv = Object.fromEntries(
	authTemplate.Config.Env.map((item) => [
		item.slice(0, item.indexOf("=")),
		item.slice(item.indexOf("=") + 1),
	]),
);
const secret = authEnv.GOTRUE_JWT_SECRET;
if (!secret) {
	throw new Error("Local JWT signing configuration is required.");
}
const jwt = (role: string, sub?: string) => {
	const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
	const body = `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ role, aud: "authenticated", sub, iss: "supabase", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}`;
	return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
};
const network = Object.keys(authTemplate.NetworkSettings.Networks)[0];
const temp = resolve("supabase/.temp/release-check");
mkdirSync(temp, { recursive: true });
const names: string[] = [],
	files: string[] = [];
let edge: ChildProcess | undefined;
const base = "http://127.0.0.1:56420";
const proxy = createServer(async (request, response) => {
	try {
		const auth = request.url?.startsWith("/auth/v1");
		const path = (request.url ?? "/").replace(auth ? /^\/auth\/v1/ : /^\/rest\/v1/, "");
		const chunks: Buffer[] = [];
		for await (const chunk of request) {
			chunks.push(Buffer.from(chunk));
		}
		const body = Buffer.concat(chunks);
		const headers = new Headers();
		for (const [name, value] of Object.entries(request.headers)) {
			if (value && name !== "host" && name !== "content-length") {
				headers.set(name, Array.isArray(value) ? value.join(",") : value);
			}
		}
		const result = await fetch(`http://127.0.0.1:${auth ? 56422 : 56421}${path}`, {
			method: request.method,
			headers,
			body: body.length ? body : undefined,
		});
		const outgoing = new Headers(result.headers);
		for (const name of ["content-length", "transfer-encoding", "content-encoding"]) {
			outgoing.delete(name);
		}
		response.writeHead(result.status, Object.fromEntries(outgoing));
		response.end(Buffer.from(await result.arrayBuffer()));
	} catch {
		response.writeHead(502);
		response.end();
	}
});
async function start(
	template: Container,
	name: string,
	port: number,
	dbVariable: string,
	extra: Record<string, string> = {},
) {
	const env = Object.fromEntries(
		template.Config.Env.map((item) => [
			item.slice(0, item.indexOf("=")),
			item.slice(item.indexOf("=") + 1),
		]),
	);
	const url = new URL(env[dbVariable]);
	url.pathname = `/${database}`;
	env[dbVariable] = url.href;
	Object.assign(env, extra);
	// Redirect all email into the existing local catcher. generateLink is used below,
	// so the test never sends to an external SMTP server, even if templates change.
	if (dbVariable === "GOTRUE_DB_DATABASE_URL") {
		env.GOTRUE_SMTP_HOST = "supabase_inbucket_typa";
		env.GOTRUE_SMTP_PORT = "2500";
		env.GOTRUE_SMTP_USER = "";
		env.GOTRUE_SMTP_PASS = "";
	}
	const path = resolve(temp, `${name}.env`);
	files.push(path);
	writeFileSync(
		path,
		Object.entries(env)
			.map(([key, value]) => `${key}=${value}`)
			.join("\n"),
	);
	docker(
		"run",
		"--detach",
		"--name",
		name,
		"--network",
		network,
		"--publish",
		`127.0.0.1:${port}:${port === 56421 ? 3000 : 9999}`,
		"--env-file",
		path,
		template.Config.Image,
	);
	names.push(name);
}
const required = <T extends { data: unknown; error: unknown }>(result: T): T["data"] => {
	if (result.error) {
		throw new Error(`API call failed: ${JSON.stringify(result.error)}`);
	}
	return result.data;
};
try {
	await start(restTemplate, "typa_release_rest", 56421, "PGRST_DB_URI");
	await start(authTemplate, "typa_release_auth", 56422, "GOTRUE_DB_DATABASE_URL", {
		GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED: "true",
		GOTRUE_HOOK_BEFORE_USER_CREATED_URI: "pg-functions://postgres/public/hook_before_user_created",
		GOTRUE_MAILER_AUTOCONFIRM: "true",
		API_EXTERNAL_URL: `${base}/auth/v1`,
	});
	await new Promise<void>((resolve) => proxy.listen(56420, "127.0.0.1", resolve));
	for (let i = 0; i < 60; i++) {
		if (
			await fetch(`${base}/auth/v1/health`)
				.then((r) => r.ok)
				.catch(() => false)
		) {
			break;
		}
		await new Promise((r) => setTimeout(r, 250));
		if (i === 59) {
			const logged = spawnSync("docker", ["logs", "typa_release_auth"], { encoding: "utf8" });
			const logs = (logged.stdout + logged.stderr)
				.replaceAll(secret, "[redacted]")
				.replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+@/g, "$1[redacted]@");
			throw new Error(`Isolated Auth server did not start: ${logs.slice(-4000)}`);
		}
	}
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
	const notice = (token: string) =>
		fetch("http://127.0.0.1:56423", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({ sheetId: id }),
		});
	assert.equal((await notice("invalid-token")).status, 401);
	assert.equal((await notice(session.access_token)).status, 409); // Missing SMTP: tracked failure, no external send.
	assert.equal((await notice(session.access_token)).status, 429); // A second request is rate limited.
	console.log("API: subject submission and real notification HTTP authorization/cooldown passed.");
	await evaluatorSession(2);
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
	proxy.closeAllConnections();
	await new Promise<void>((resolve) => proxy.close(() => resolve()));
	for (const name of names.reverse()) {
		try {
			docker("rm", "--force", name);
		} catch {}
	}
	for (const file of files) {
		try {
			unlinkSync(file);
		} catch {}
	}
}
