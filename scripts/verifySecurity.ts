import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import policy from "../security/requirements.json";
import { startIsolatedApi } from "./isolatedApi";
import {
	assertSecurityChecks,
	assertZapExecution,
	assertZapReport,
	type CheckResult,
	redactSecurityText,
} from "./securityEvidence";

const database = process.argv[2];
assert.ok(
	["typa_release_fresh", "typa_release_verify"].includes(database),
	"Only prepared isolated release databases may be security-tested",
);
const out = resolve("supabase/.temp/security-evidence", database);
const privateDir = resolve("supabase/.temp/security-private", database);
const rawDir = resolve(privateDir, "reports");
for (const directory of [out, privateDir, rawDir]) {
	mkdirSync(directory, { recursive: true });
}
chmodSync(rawDir, 0o777);
// Never accept a previous run's evidence, including after a failed process launch.
for (const file of [
	"results.json",
	"zap-report.json",
	"zap.log",
	"zap-auth-negative-report.json",
	"zap-auth-negative.log",
]) {
	const path = resolve(out, file);
	if (existsSync(path)) {
		unlinkSync(path);
	}
}
const rawReport = resolve(rawDir, "zap-report.json");
if (existsSync(rawReport)) {
	unlinkSync(rawReport);
}
const planPath = resolve("security/zap/plan.yaml");
const image = readFileSync("security/zap/image.txt", "utf8").trim();
assert.match(
	image,
	/^ghcr\.io\/zaproxy\/zaproxy:2\.17\.0@sha256:[a-f0-9]{64}$/,
	"Pin the ZAP image by version and digest",
);
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const results: CheckResult[] = [];
const secrets: string[] = [];
const password = `Security-${randomUUID()}-Aa9!`;
secrets.push(password);
let api: Awaited<ReturnType<typeof startIsolatedApi>> | undefined;
let zapSummary: ReturnType<typeof assertZapReport> | undefined;
let zapAttacks: Record<string, number> | undefined;
let zapNegativeControl = false;
let passed = false;
const fixtureIds = [990001, 990002, 990003, 990004, 990005, 990006];
const marker = "SECURITY_OWNER_MARKER";
const envFile = resolve(privateDir, "zap.env");
const clients: { realtime: { disconnect: () => void } }[] = [];

async function check(id: string, operation: () => Promise<void>) {
	assert.ok(
		policy.required.some((requirement) => requirement.id === id),
		"Unknown security check",
	);
	const start = Date.now();
	try {
		await operation();
		results.push({ id, status: "passed", durationMs: Date.now() - start });
		console.log(`Security ${id}: passed`);
	} catch (error) {
		results.push({ id, status: "failed", durationMs: Date.now() - start });
		throw new Error(`Security ${id}: ${error instanceof Error ? error.message : "failed"}`);
	}
}

try {
	api = await startIsolatedApi(database);
	const { base, jwt, sql, network } = api;
	const serviceKey = jwt("service_role");
	secrets.push(serviceKey);
	const service = createClient(base, serviceKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
	clients.push(service);
	const identities: { id: number; userId: string; email: string; token: string }[] = [];
	for (const [index, id] of fixtureIds.entries()) {
		const email = `security-${randomUUID()}@release.example`;
		const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
		assert.ok(!created.error && created.data.user, "Could not create synthetic Auth fixture");
		const client = createClient(base, jwt("anon"), {
			auth: { persistSession: false, autoRefreshToken: false },
		});
		clients.push(client);
		const login = await client.auth.signInWithPassword({ email, password });
		assert.ok(!login.error && login.data.session, "Synthetic password login failed");
		secrets.push(login.data.session.access_token, login.data.session.refresh_token);
		identities.push({
			id,
			userId: created.data.user.id,
			email,
			token: login.data.session.access_token,
		});
		// Last identity is intentionally not linked to an employee.
		if (index < 5) {
			assert.match(created.data.user.id, /^[a-f0-9-]{36}$/);
			const role = index === 0 ? "Admin" : index < 3 ? "Reviewer" : "Employee";
			sql(`insert into public.employees(id,user_id,name,employee_no,role_id,grade_id)
				values(${id},'${created.data.user.id}','Security fixture ${index}','SECURITY${id}',
				(select id from public.roles where role_name='${role}'),9001)
				on conflict(id) do update set user_id=excluded.user_id,is_enabled=true;`);
		}
	}
	const [admin, primary, secondary, owner, other, unlinked] = identities;
	sql(`update public.employees set name='${marker}',primary_evaluator_id=${primary.id},secondary_evaluator_id=${secondary.id} where id=${owner.id};
		delete from public.evaluation_sheets where employee_id=${owner.id};
		update public.evaluation_periods set is_active=true,closed_at=null where id=900001;`);
	const call = async (path: string, token: string | null, method = "POST", body?: unknown) => {
		const response = await fetch(`${base}/rest/v1/${path}`, {
			method,
			headers: {
				...(token ? { Authorization: `Bearer ${token}` } : {}),
				"Content-Type": "application/json",
				Prefer: "return=representation",
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(15_000),
		});
		return { status: response.status, body: (await response.json()) as unknown };
	};
	const rpc = (name: string, token: string | null, body: unknown = {}) =>
		call(`rpc/${name}`, token, "POST", body);
	const created = await call("evaluation_sheets?select=id", owner.token, "POST", {
		period_id: 900001,
		employee_id: owner.id,
	});
	assert.equal(created.status, 201, "Owner must be able to create a sheet");
	const sheetId = (created.body as { id: number }[])[0].id;
	const goal = await call("milestones?select=id", owner.token, "POST", {
		sheet_id: sheetId,
		goal_number: 1,
		challenge_goal: marker,
	});
	assert.equal(goal.status, 201);
	const goalId = (goal.body as { id: number }[])[0].id;
	const sheetSnapshot = () =>
		sql(
			`select jsonb_build_object('sheet',(select to_jsonb(s) from public.evaluation_sheets s where id=${sheetId}),'goal',(select to_jsonb(g) from public.milestones g where id=${goalId}))`,
		);
	const sheetArgs = { p_sheet_id: sheetId };
	const readSheet = (token: string | null) => rpc("get_sheet", token, sheetArgs);
	const transition = (token: string, status: string, reason?: string) =>
		rpc("transition_evaluation_sheet", token, {
			...sheetArgs,
			p_status: status,
			...(reason === undefined ? {} : { p_reason: reason }),
		});
	const assertDocument = (response: { status: number; body: unknown }) => {
		assert.equal(response.status, 200);
		assert.ok(JSON.stringify(response.body).includes(marker), "Protected document was not reached");
	};
	await check("AUTH-LOGIN", async () => {
		assert.equal((await rpc("current_employee_id", owner.token)).body, owner.id);
		assertDocument(await readSheet(owner.token));
	});
	await check("AUTH-ANON", async () => {
		for (const token of [null, jwt("anon")]) {
			assert.equal((await readSheet(token)).status, 401);
			assert.equal(
				(
					await rpc("set_employee_role", token, {
						p_employee_no: `SECURITY${owner.id}`,
						p_role_name: "Admin",
					})
				).status,
				401,
			);
		}
	});
	await check("AUTH-JWT", async () => {
		const token = owner.token.split(".");
		const tampered = `${token[0]}.${Buffer.from(JSON.stringify({ role: "authenticated", sub: admin.userId, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.${token[2]}`;
		const unsigned = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${token[1]}.`;
		for (const invalid of [
			tampered,
			unsigned,
			jwt("authenticated", owner.userId, { exp: 1 }),
			jwt("authenticated", owner.userId, { nbf: Math.floor(Date.now() / 1000) + 3600 }),
		]) {
			secrets.push(invalid);
			assert.equal((await readSheet(invalid)).status, 401, "Invalid JWT reached a protected RPC");
		}
		assertDocument(await readSheet(owner.token));
	});
	await check("AUTH-UNLINKED", async () => {
		assert.equal((await readSheet(unlinked.token)).body, null);
		assert.equal((await transition(unlinked.token, "finalized")).status, 403);
	});
	await check("ACCESS-BOLA", async () => {
		const before = sheetSnapshot();
		// Admin は全社のシートを読み取り専用で開ける(読めても、改変・確定はできない)
		assertDocument(await readSheet(admin.token));
		for (const token of [other.token, admin.token, unlinked.token]) {
			if (token !== admin.token) {
				assert.equal((await readSheet(token)).body, null);
			}
			assert.equal((await transition(token, "finalized")).status, 403);
			const updated = await call(`milestones?id=eq.${goalId}&select=id`, token, "PATCH", {
				challenge_goal: "attack",
			});
			assert.equal(updated.status, 200);
			assert.deepEqual(updated.body, []);
		}
		assert.equal(sheetSnapshot(), before);
	});
	await check("ACCESS-BFLA", async () => {
		for (const actor of [owner, primary]) {
			for (const [name, args] of [
				["set_employee_role", { p_employee_no: `SECURITY${owner.id}`, p_role_name: "Admin" }],
				["issue_employee_invitation", { p_employee_no: "RELEASE007" }],
				[
					"privileged_sheet_operation",
					{
						...sheetArgs,
						p_action: "delete",
						p_status: null,
						p_expected_status: "draft",
						p_reason: "attack",
					},
				],
				[
					"change_sheet_grade",
					{
						...sheetArgs,
						p_grade_id: 9001,
						p_expected_grade_id: null,
						p_expected_status: "draft",
						p_reason: "attack",
					},
				],
			] as const) {
				assert.equal(
					(await rpc(name, actor.token, args)).status,
					403,
					`${name} did not reject a non-Admin`,
				);
			}
		}
	});
	await check("ACCESS-FIELDS", async () => {
		const before = sheetSnapshot();
		const response = await call(`milestones?id=eq.${goalId}&select=id`, owner.token, "PATCH", {
			challenge_goal: "attack",
			first_score: 4,
		});
		assert.equal(response.status, 403);
		assert.equal(sheetSnapshot(), before);
		// PostgREST projection syntax is not a filesystem path. Depending on its
		// version this probe is rejected or returns the allowed row ID, never a file.
		const projection = await call(
			`milestones?id=eq.${goalId}&select=%2Fmilestones`,
			owner.token,
			"PATCH",
			{ challenge_goal: "projection probe" },
		);
		if (projection.status === 400) {
			assert.equal(sheetSnapshot(), before);
		} else {
			assert.equal(projection.status, 200);
			assert.deepEqual(projection.body, [{ id: goalId }]);
		}
		const restored = await call(`milestones?id=eq.${goalId}&select=id`, owner.token, "PATCH", {
			challenge_goal: marker,
		});
		assert.equal(restored.status, 200);
		assert.deepEqual(restored.body, [{ id: goalId }]);
		assert.equal(sql(`select challenge_goal from public.milestones where id=${goalId}`), marker);
	});
	await check("ACCESS-SUSPEND", async () => {
		assertDocument(await readSheet(owner.token));
		sql(`update public.employees set is_enabled=false where id=${owner.id}`);
		try {
			assert.equal((await readSheet(owner.token)).body, null);
			assert.equal((await transition(owner.token, "goals_submitted")).status, 403);
		} finally {
			sql(`update public.employees set is_enabled=true where id=${owner.id}`);
		}
	});
	await check("FLOW-APPROVAL", async () => {
		const before = sheetSnapshot();
		for (const status of ["submitted", "first_evaluated", "finalized"]) {
			assert.equal((await transition(owner.token, status)).status, 403);
		}
		assert.equal(sheetSnapshot(), before);
		assert.equal((await transition(owner.token, "goals_submitted")).status, 200);
		const notices = () =>
			sql(`select count(*) from public.notifications where sheet_id=${sheetId}`);
		const count = notices();
		assert.equal(count, "1");
		assert.equal((await transition(owner.token, "goals_submitted")).status, 403);
		assert.equal(notices(), count);
		// 差し戻しには理由が要る。理由のない・空白だけの差し戻しは、状態を変えずに断る
		const submitted = sheetSnapshot();
		for (const reason of [undefined, " 　"]) {
			assert.equal((await transition(primary.token, "draft", reason)).status, 400);
		}
		assert.equal(sheetSnapshot(), submitted);
		assert.equal((await transition(primary.token, "draft", "security check")).status, 200);
	});
	await check("DATA-SECRET", async () => {
		for (const actor of [owner, admin]) {
			assert.equal(
				(await call("workspace_settings?select=smtp_password", actor.token, "GET")).status,
				403,
			);
		}
	});
	await check("AUDIT-ATOMIC", async () => {
		for (const actor of [owner, admin]) {
			assert.equal(
				(await call("security_audit_log", actor.token, "POST", { action: "forged" })).status,
				403,
			);
			assert.equal((await call("security_audit_log?id=gt.0", actor.token, "DELETE")).status, 403);
		}
		const before = sheetSnapshot();
		sql(`create function public.security_fixture_reject_audit() returns trigger language plpgsql as $$ begin if new.action like 'sheet.privileged_%' then raise exception 'synthetic audit outage'; end if; return new; end $$;
			create trigger security_fixture_reject_audit before insert on public.security_audit_log for each row execute function public.security_fixture_reject_audit();`);
		try {
			const response = await rpc("privileged_sheet_operation", admin.token, {
				...sheetArgs,
				p_action: "delete",
				p_status: null,
				p_expected_status: "draft",
				p_reason: "test audit rollback",
			});
			assert.equal(response.status, 400);
			assert.equal(sheetSnapshot(), before);
		} finally {
			sql(
				"drop trigger security_fixture_reject_audit on public.security_audit_log; drop function public.security_fixture_reject_audit()",
			);
		}
	});
	await check("AUTH-RATE", async () => {
		let limited = false;
		for (let i = 0; i < 80; i++) {
			const response = await fetch(`${base}/auth/v1/token?grant_type=password`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					apikey: jwt("anon"),
					"X-Forwarded-For": `192.0.2.${i + 1}`,
					"Sb-Forwarded-For": `192.0.2.${i + 1}`,
				},
				body: JSON.stringify({ email: owner.email, password: "wrong-synthetic-password" }),
				signal: AbortSignal.timeout(10_000),
			});
			const body = (await response.json()) as Record<string, unknown>;
			assert.ok(
				!body.access_token && !body.refresh_token,
				"Failed password attempt returned a session",
			);
			if (response.status === 429) {
				limited = true;
				break;
			}
			assert.ok(
				response.status === 400 || response.status === 422,
				"Unexpected password failure response",
			);
		}
		assert.ok(limited, "Password-grant endpoint did not rate limit within 80 attempts");
		let recovered = false;
		const deadline = Date.now() + 20_000;
		while (Date.now() < deadline) {
			await new Promise((done) => setTimeout(done, 2500));
			const response = await fetch(`${base}/auth/v1/token?grant_type=password`, {
				method: "POST",
				headers: { "Content-Type": "application/json", apikey: jwt("anon") },
				body: JSON.stringify({ email: owner.email, password }),
				signal: AbortSignal.timeout(10_000),
			});
			const body = (await response.json()) as Record<string, unknown>;
			if (response.status === 200) {
				assert.equal(typeof body.access_token, "string");
				secrets.push(String(body.access_token), String(body.refresh_token));
				recovered = true;
				break;
			}
			assert.equal(response.status, 429);
		}
		assert.ok(recovered, "Valid password login did not recover within 20 seconds");
	});
	await check("DAST-AUTHENTICATED", async () => {
		const scan = async (token: string, prefix: "zap" | "zap-auth-negative") => {
			if (existsSync(rawReport)) {
				unlinkSync(rawReport);
			}
			writeFileSync(
				envFile,
				`ZAP_AUTH_HEADER=Authorization\nZAP_AUTH_HEADER_VALUE=Bearer ${token}\nZAP_AUTH_HEADER_SITE=typa_release_rest\nZAP_SHEET_ID=${sheetId}\nZAP_GOAL_ID=${goalId}\n`,
				{
					mode: 0o600,
				},
			);
			let log = "";
			const code = await new Promise<number>((done, reject) => {
				const child = spawn(
					"docker",
					[
						"run",
						"--rm",
						"--name",
						"typa_security_zap",
						"--network",
						network,
						"--env-file",
						envFile,
						"--mount",
						`type=bind,source=${resolve("security/zap")},target=/zap/wrk/plan,readonly`,
						"--mount",
						`type=bind,source=${rawDir},target=/zap/wrk/reports`,
						image,
						"zap.sh",
						"-cmd",
						"-autorun",
						"/zap/wrk/plan/plan.yaml",
					],
					{ stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
				);
				const timer = setTimeout(() => {
					spawnSync("docker", ["rm", "--force", "typa_security_zap"], {
						windowsHide: true,
						timeout: 15_000,
					});
					child.kill();
					reject(new Error("ZAP exceeded its 10-minute deadline"));
				}, 600_000);
				const append = (data: Buffer) => {
					log += data.toString();
					if (log.length > 5_000_000) {
						child.kill();
						reject(new Error("ZAP log exceeded its limit"));
					}
				};
				child.stdout.on("data", append);
				child.stderr.on("data", append);
				child.on("error", (error) => {
					clearTimeout(timer);
					reject(error);
				});
				child.on("close", (value) => {
					clearTimeout(timer);
					done(value ?? -1);
				});
			}).finally(() =>
				writeFileSync(resolve(out, `${prefix}.log`), redactSecurityText(log, secrets)),
			);
			assert.ok(existsSync(rawReport), "ZAP did not produce a report");
			const report = readFileSync(rawReport, "utf8");
			writeFileSync(resolve(out, `${prefix}-report.json`), redactSecurityText(report, secrets));
			return { code, log, report };
		};
		// A broken authentication setup must make this exact plan fail, rather than
		// merely producing a clean-looking unauthenticated scan report.
		const negative = await scan("invalid-security-probe-token", "zap-auth-negative");
		assert.ok(
			negative.code === 1 || negative.code === 2,
			"ZAP accepted a broken authentication setup",
		);
		assert.match(negative.log, /Received : 401/);
		assert.match(negative.log, /test type url has failed/);
		zapNegativeControl = true;
		const positive = await scan(owner.token, "zap");
		assert.equal(positive.code, 0, "ZAP failed; see sanitized zap.log and zap-report.json");
		zapAttacks = assertZapExecution(positive.log);
		zapSummary = assertZapReport(JSON.parse(positive.report));
		assertDocument(await readSheet(owner.token));
	});
	assertSecurityChecks(results);
	passed = true;
} catch (error) {
	console.error(
		redactSecurityText(
			error instanceof Error ? error.message : "Security verification failed",
			secrets,
		),
	);
	process.exitCode = 1;
} finally {
	const git = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true });
	writeFileSync(
		resolve(out, "results.json"),
		JSON.stringify(
			{
				standard: policy.standard,
				scope: policy.scope,
				database,
				passed,
				commit: git.stdout.trim(),
				completedAt: new Date().toISOString(),
				policySha256: hash("security/requirements.json"),
				planSha256: hash(planPath),
				sourceSha256: {
					verifier: hash("scripts/verifySecurity.ts"),
					gateway: hash("scripts/isolatedApi.ts"),
					evidenceGate: hash("scripts/securityEvidence.ts"),
					configuration: hash("supabase/config.toml"),
				},
				zapImage: image,
				images: api?.images,
				authSettings: api?.authSettings,
				zap: zapSummary,
				zapAttacks,
				zapNegativeControl,
				required: policy.required.map((requirement) => ({
					...requirement,
					result: results.find((result) => result.id === requirement.id) ?? { status: "not_run" },
				})),
				pending: policy.pending,
			},
			null,
			2,
		),
	);
	for (const client of clients) {
		client.realtime.disconnect();
	}
	if (existsSync(envFile)) {
		unlinkSync(envFile);
	}
	if (existsSync(rawReport)) {
		unlinkSync(rawReport);
	}
	spawnSync("docker", ["rm", "--force", "typa_security_zap"], {
		stdio: "ignore",
		windowsHide: true,
		timeout: 15_000,
	});
	await api?.stop();
}
