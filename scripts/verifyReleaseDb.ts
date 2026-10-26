import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

// This script never connects to the running application's database. Both targets
// must be explicitly prepared isolated copies; no employee data is printed.
const database = process.argv[2];
if (!["typa_release_verify", "typa_release_fresh"].includes(database)) {
	throw new Error("An isolated release database is required.");
}
const args = [
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
	"-At",
	"-q",
];
function sql(statement: string): string {
	const r = spawnSync("docker", args, { input: statement, encoding: "utf8" });
	if (r.status !== 0) {
		throw new Error(r.stderr.trim());
	}
	return r.stdout.trim();
}
function asyncSql(statement: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const p = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
		let out = "",
			error = "";
		p.stdout.on("data", (data) => {
			out += data;
		});
		p.stderr.on("data", (data) => {
			error += data;
		});
		p.on("error", reject);
		p.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(error.trim()))));
		p.stdin.end(statement);
	});
}
const uid = (n: number) => `00000000-0000-0000-0000-${String(900000 + n).padStart(12, "0")}`;
const as = (n: number, statement: string) =>
	`set role authenticated; select set_config('request.jwt.claim.sub','${uid(n)}',false); ${statement}`;
const last = (text: string) => text.split(/\r?\n/).at(-1);
const parsed = <T>(text: string): T => JSON.parse(last(text) ?? "null");
sql(readFileSync(new URL("../security/release-fixture.sql", import.meta.url), "utf8"));

const sheet = Number(
	last(
		sql(
			as(
				4,
				"insert into public.evaluation_sheets(period_id,employee_id) values(900001,900004) returning id;",
			),
		),
	),
);
sql(
	as(
		4,
		`insert into public.milestones(sheet_id,goal_number,challenge_goal) values(${sheet},1,'Release goal'); select public.transition_evaluation_sheet(${sheet},'goals_submitted');`,
	),
);
sql(as(2, `select public.transition_evaluation_sheet(${sheet},'goals_confirmed');`));
sql(
	as(
		4,
		`update public.milestones set achievement='Challenge achievement' where sheet_id=${sheet}; select public.transition_evaluation_sheet(${sheet},'submitted');`,
	),
);

sql(
	as(
		2,
		`update public.milestones set first_score=4 where sheet_id=${sheet}; select public.save_common_evaluation(${sheet},(select jsonb_agg(jsonb_build_object('itemId',(item->>'itemId')::bigint,'firstScore',4)) from jsonb_array_elements(public.get_sheet(${sheet})->'commonResults') item));`,
	),
);

// Hold the parent row in the evaluator's save transaction. Confirmation must wait,
// then include the score that save committed, rather than an earlier snapshot.
const saving = asyncSql(
	as(
		2,
		`begin; set application_name='typa-release-save'; update public.milestones set first_score=2 where sheet_id=${sheet}; select pg_sleep(1.5); commit;`,
	),
);
for (let i = 0; i < 60; i++) {
	if (
		sql(
			"select count(*) from pg_stat_activity where application_name='typa-release-save' and wait_event='PgSleep'",
		) === "1"
	) {
		break;
	}
	await new Promise((r) => setTimeout(r, 50));
	if (i === 59) {
		throw new Error("Save transaction did not reach the concurrency barrier.");
	}
}
const first = parsed<{ firstRank: string }>(
	await asyncSql(as(2, `select public.transition_evaluation_sheet(${sheet},'first_evaluated');`)),
);
await saving;
assert.equal(first.firstRank, "A"); // 10 + 80 = 90, not the old 100

sql(
	as(
		3,
		`update public.milestones set second_score=2 where sheet_id=${sheet}; select public.save_common_evaluation(${sheet},(select jsonb_agg(jsonb_build_object('itemId',(item->>'itemId')::bigint,'secondScore',3)) from jsonb_array_elements(public.get_sheet(${sheet})->'commonResults') item));`,
	),
);
const finalizing = asyncSql(
	as(
		3,
		`begin; set application_name='typa-release-finalize'; select public.transition_evaluation_sheet(${sheet},'finalized'); select pg_sleep(1.5); commit;`,
	),
);
for (let i = 0; i < 60; i++) {
	if (
		sql(
			"select count(*) from pg_stat_activity where application_name='typa-release-finalize' and wait_event='PgSleep'",
		) === "1"
	) {
		break;
	}
	await new Promise((r) => setTimeout(r, 50));
	if (i === 59) {
		throw new Error("Confirmation did not reach the concurrency barrier.");
	}
}
await Promise.all([
	assert.rejects(
		asyncSql(
			as(
				3,
				`select public.save_common_evaluation(${sheet},'[{"itemId":900001,"secondScore":4}]'::jsonb);`,
			),
		),
		/権限/,
	),
	assert.rejects(
		asyncSql(as(3, `update public.milestones set second_score=4 where sheet_id=${sheet};`)),
		/変更できません|権限/,
	),
]);
await finalizing;
assert.equal(sql(`select second_score from public.milestones where sheet_id=${sheet}`), "2");
const finalized = parsed<{
	stored: {
		totalEvaluationScore: number;
		objectivesSecondEvaluationScore: number;
		commonEvaluationSecondEvaluationScore: number;
	};
}>(sql(as(4, `select public.get_sheet(${sheet});`)));
assert.equal(finalized.stored.totalEvaluationScore, 70);
assert.equal(
	finalized.stored.objectivesSecondEvaluationScore +
		finalized.stored.commonEvaluationSecondEvaluationScore,
	70,
);

// Exercise real PostgreSQL RLS with a still-valid identity after suspension.
sql(as(1, "select public.set_employee_enabled('RELEASE004',false);"));
assert.equal(last(sql(as(4, "select count(*) from public.evaluation_sheets;"))), "0");
assert.equal(last(sql(as(4, `select public.get_sheet(${sheet}) is null;`))), "t");
assert.equal(
	last(
		sql(
			as(
				2,
				"with changed as (update public.employees set primary_evaluator_id=900002 where id=900007 returning id) select count(*) from changed;",
			),
		),
	),
	"0",
);
// Concurrent self-demotions must leave one usable Admin, including when both
// transactions initially see the other. Only synthetic fixture state is retained.
sql(
	"update public.employees set role_id=(select id from public.roles where role_name='Employee') where role_id=(select id from public.roles where role_name='Admin') and id<>900001; update public.employees set role_id=(select id from public.roles where role_name='Admin') where id=900005;",
);
const demotions = await Promise.allSettled([
	asyncSql(as(1, "select public.set_employee_role('RELEASE001','Employee');")),
	asyncSql(as(5, "select public.set_employee_role('RELEASE005','Employee');")),
]);
assert.equal(demotions.filter((r) => r.status === "fulfilled").length, 1);
assert.equal(
	sql(
		"select count(*) from public.employees e join public.roles r on r.id=e.role_id where r.role_name='Admin' and e.is_enabled and e.user_id is not null",
	),
	"1",
);
sql(
	"update public.employees set role_id=(select id from public.roles where role_name='Admin') where id=900001; update public.employees set role_id=(select id from public.roles where role_name='Employee') where id=900005;",
);

console.log(
	`${database}: real PostgreSQL transitions, aggregates, concurrent save/confirm, frozen content, suspension, concurrent Admin protection and Reviewer authorization passed.`,
);
