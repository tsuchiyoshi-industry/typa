import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const target = process.argv[2];
assert.ok(
	["typa_release_verify", "typa_release_fresh", "typa_e2e"].includes(target),
	"Only isolated release databases may be prepared.",
);
const docker = (args: string[], input?: string) => {
	const r = spawnSync("docker", args, { input, encoding: "utf8" });
	if (r.status !== 0) {
		throw new Error(
			`Verification database preparation failed (${args[0]}). The application database was not modified.`,
		);
	}
	return r.stdout.trim();
};
const sql = (text: string) =>
	docker(
		[
			"exec",
			"-i",
			"supabase_db_typa",
			"psql",
			"-U",
			"postgres",
			"-d",
			target,
			"-v",
			"ON_ERROR_STOP=1",
			"-q",
			"-At",
		],
		text,
	);
const temp = resolve("supabase/.temp/release-check");
mkdirSync(temp, { recursive: true });
const exists = docker([
	"exec",
	"supabase_db_typa",
	"psql",
	"-U",
	"postgres",
	"-d",
	"postgres",
	"-At",
	"-c",
	`select count(*) from pg_database where datname='${target}'`,
]);
if (exists === "1") {
	assert.ok(
		process.argv.includes("--replace"),
		"Verification database already exists. Pass --replace to replace this isolated fixture.",
	);
	docker(["exec", "supabase_db_typa", "dropdb", "-U", "postgres", target]);
}
docker([
	"exec",
	"supabase_db_typa",
	"pg_dump",
	"-U",
	"postgres",
	"-d",
	"postgres",
	"-Fc",
	"-f",
	"/tmp/typa-release-platform.dump",
]);
docker([
	"exec",
	"supabase_db_typa",
	"pg_dump",
	"-U",
	"postgres",
	"-d",
	"postgres",
	"--data-only",
	"-t",
	"auth.schema_migrations",
	"-f",
	"/tmp/typa-release-auth-history.sql",
]);
docker(["exec", "supabase_db_typa", "createdb", "-U", "postgres", target]);
// Use the local Supabase administrative role for Supabase-owned extension schemas.
// Password expansion stays inside the container and is never returned or logged.
docker([
	"exec",
	"supabase_db_typa",
	"sh",
	"-c",
	`PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -U supabase_admin -d ${target} --schema-only --exit-on-error /tmp/typa-release-platform.dump`,
]);
sql("drop schema public cascade; create schema public authorization postgres;");
docker([
	"exec",
	"supabase_db_typa",
	"sh",
	"-c",
	`PGPASSWORD="$POSTGRES_PASSWORD" psql -U supabase_admin -d ${target} -v ON_ERROR_STOP=1 -q -f /tmp/typa-release-auth-history.sql`,
]);
const apply = (file: string) => {
	docker([
		"cp",
		resolve("supabase/migrations", file),
		"supabase_db_typa:/tmp/typa-release-migration.sql",
	]);
	docker([
		"exec",
		"supabase_db_typa",
		"psql",
		"-U",
		"postgres",
		"-d",
		target,
		"-v",
		"ON_ERROR_STOP=1",
		"-q",
		"-f",
		"/tmp/typa-release-migration.sql",
	]);
};
const files = readdirSync("supabase/migrations")
	.filter((f) => f.endsWith(".sql"))
	.sort();
const upgrade = target === "typa_release_verify";
for (const file of files.filter((f) => !upgrade || f < "202610160001")) {
	apply(file);
}
if (upgrade) {
	sql(`insert into public.roles(role_name) values('Employee');
    insert into public.employees(id,name,employee_no,role_id) values(900099,'Legacy fixture','LEGACY',(select id from public.roles where role_name='Employee'));
    insert into public.evaluation_periods(id,period_name,start_date,end_date,is_active) values(900099,'Legacy fixture','2026-04-01','2026-09-30',true);
    insert into public.evaluation_sheets(id,period_id,employee_id,status,first_rank,final_rank_letter,final_rank_level,total_evaluation_score,objective_allocation,common_allocation)
      values(900099,900099,900099,'finalized','A','A','none',90,20,80);`);
	for (const file of files.filter((f) => f >= "202610160001")) {
		apply(file);
	}
	assert.equal(
		sql(
			"select status||':'||first_rank||':'||final_rank_letter||':'||total_evaluation_score from public.evaluation_sheets where id=900099",
		),
		"finalized:A:A:90",
	);
}
assert.equal(
	sql(readFileSync("security/schema-inventory.sql", "utf8")).replaceAll("\r\n", "\n"),
	readFileSync("security/schema-inventory.expected.txt", "utf8").replaceAll("\r\n", "\n").trim(),
	"Migrated schema privileges, policies, functions, triggers and constraints must match the committed inventory.",
);
console.log(
	`${target}: ${upgrade ? "legacy schema with finalized history upgraded" : "every migration replayed from baseline"}; Auth platform migration history preserved.`,
);
