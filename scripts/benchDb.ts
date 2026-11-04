/**
 * DB の速さを、アプリと同じ問い合わせで権限ごとに測る(画面側の bench では測れない、RLS と DB 関数のぶん)。
 *
 *   bun scripts/prepareReleaseDb.ts typa_bench --replace && bun scripts/benchDb.ts typa_bench
 *
 * 隔離 DB にデモ用のダミーデータ(610 人・10 期間・6,090 枚。scripts/generateSeed.ts)を入れ、本物の
 * Auth と PostgREST 越しに、管理者・部長・課長・課員でそれぞれ 5 回投げて中央値を取る。
 * どれかが BUDGET_MS を超えたら失敗する(行ごとに関数を呼ぶポリシーなど、件数に比例して遅くなる変更を止める)。
 * 結果は .vitest/bench/db-results.json(CI ではアーティファクト)。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isolatedSql, startIsolatedApi } from "./isolatedApi";

const BUDGET_MS = 1000;
const database = process.argv[2] ?? "typa_bench";

const seeded = spawnSync("bun", ["scripts/generateSeed.ts"], { encoding: "utf8", shell: true });
if (seeded.status !== 0) {
	throw new Error(`ダミーデータを作れませんでした: ${seeded.stderr || seeded.stdout}`);
}
const loaded = spawnSync(
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
		"-o",
		"/dev/null",
	],
	{ input: readFileSync("supabase/seed.sql"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (loaded.status !== 0) {
	throw new Error(`ダミーデータを ${database} に入れられませんでした: ${loaded.stderr}`);
}

// 測る人: Admin、Admin が一次評価者の部長、部長が一次評価者の課長、課長が一次評価者の課員
const [active, ...people] = isolatedSql(
	database,
	`select id from public.evaluation_periods where is_active;
	 with picked as (
	   select 'Admin' as label, (select e.id from public.employees e join public.roles r on r.id = e.role_id where r.role_name = 'Admin' order by e.id limit 1) as id
	 ), head as (
	   select '部長' as label, (select e.id from public.employees e join picked a on e.primary_evaluator_id = a.id order by e.id limit 1) as id
	 ), chief as (
	   select '課長' as label, (select e.id from public.employees e join head h on e.primary_evaluator_id = h.id join public.roles r on r.id = e.role_id where r.role_name = 'Reviewer' order by e.id limit 1) as id
	 ), member as (
	   select '課員' as label, (select e.id from public.employees e join chief c on e.primary_evaluator_id = c.id where e.user_id is not null and e.is_enabled order by e.id limit 1) as id
	 )
	 select p.label || '|' || e.id || '|' || e.employee_no || '|' || coalesce((select max(s.id) from public.evaluation_sheets s where s.employee_id = e.id), 0)
	 from (select * from picked union all select * from head union all select * from chief union all select * from member) p
	 join public.employees e on e.id = p.id;`,
).split("\n");
const activePeriod = Number(active);

const api = await startIsolatedApi(database);
const anon = api.jwt("anon");
const LIST =
	"id,period_id,employee_id,status,total_score,created_at,updated_at,period:evaluation_periods!inner(id,period_name,term_name,division,part,start_date,end_date,is_active,closed_at,allow_unfinalized_close),employee:employees!inner(name,employee_no),grade:employee_grades(grade_name)";
const request = async (token: string, path: string, body?: unknown) => {
	const started = performance.now();
	const response = await fetch(`${api.base}/rest/v1/${path}`, {
		method: body ? "POST" : "GET",
		headers: { apikey: anon, authorization: `Bearer ${token}`, "content-type": "application/json" },
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`${path}: ${response.status} ${text.slice(0, 300)}`);
	}
	return { ms: performance.now() - started, bytes: text.length };
};

const results: { who: string; query: string; medianMs: number; kb: number }[] = [];
try {
	for (const line of people) {
		const [who, id, employeeNo, sheet] = line.split("|") as [string, string, string, string];
		const login = await fetch(`${api.base}/auth/v1/token?grant_type=password`, {
			method: "POST",
			headers: { apikey: anon, "content-type": "application/json" },
			body: JSON.stringify({
				email: `typa-${employeeNo.toLowerCase()}@example.com`,
				password: "typa-demo",
			}),
		});
		if (!login.ok) {
			throw new Error(`${who} がログインできません: ${login.status} ${await login.text()}`);
		}
		const token = ((await login.json()) as { access_token: string }).access_token;
		const cases: [string, string, unknown?][] = [
			["本人のシート一覧", `evaluation_sheets?select=${LIST}&employee_id=eq.${id}`],
			["評価者のシート一覧", `evaluation_sheets?select=${LIST}&employee_id=neq.${id}`],
			["評価者ワークスペース", "rpc/get_reviewer_workspace", { p_period_id: activePeriod }],
			[
				"通知",
				"notifications?select=id,sheet_id,kind,employee_name,period_name,created_at,read_at&order=created_at.desc&limit=50",
			],
			["アクセス状態", "rpc/get_current_employee_access_state", {}],
		];
		if (sheet !== "0") {
			cases.push(["シート1枚", "rpc/get_sheet", { p_sheet_id: Number(sheet) }]);
			cases.push(["前期の目標", "rpc/get_previous_goals", { p_sheet_id: Number(sheet) }]);
		}
		if (who === "Admin") {
			cases.push(["全社のシート索引", "rpc/get_sheet_index", {}]);
			cases.push(["全社のシート(1期間)", "rpc/get_sheet_overview", { p_period_id: activePeriod }]);
			cases.push([
				"期間の件数",
				"rpc/get_evaluation_period_sheet_counts",
				{ p_period_id: activePeriod },
			]);
			cases.push(["社員マスタ", "employees?select=*&order=employee_no"]);
			cases.push([
				"監査ログ",
				"security_audit_log?select=id,occurred_at,actor_user_id,action,entity_id,details&order=id.desc&limit=51",
			]);
		}
		for (const [query, path, body] of cases) {
			const runs: number[] = [];
			let bytes = 0;
			for (let i = 0; i < 5; i++) {
				const result = await request(token, path, body);
				runs.push(result.ms);
				bytes = result.bytes;
			}
			const medianMs = Math.round(runs.sort((a, b) => a - b)[2] as number);
			results.push({ who, query, medianMs, kb: Math.round(bytes / 1024) });
		}
	}
} finally {
	await api.stop();
}

console.table(results);
mkdirSync(".vitest/bench", { recursive: true });
writeFileSync(".vitest/bench/db-results.json", `${JSON.stringify(results, null, 2)}\n`);
const slow = results.filter((result) => result.medianMs > BUDGET_MS);
if (slow.length > 0) {
	throw new Error(
		`${BUDGET_MS}ms を超えた問い合わせがあります: ${slow.map((s) => `${s.who} ${s.query} ${s.medianMs}ms`).join(", ")}`,
	);
}
