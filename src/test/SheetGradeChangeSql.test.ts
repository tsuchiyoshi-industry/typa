import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { actAs, createProdLikeDb, uid } from "./prodLikeDb";

// 当期のシートの「作成時の等級」を変える。等級で変わるのは共通評価の項目だけなので、
// 共通評価の入力(点数・コメント)だけを消し、目標・点数・総評・状態・評価者には触れない。
let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
	(await db.query<T>(sql, params)).rows;
const change = (
	id: number,
	grade: number | null,
	expectedGrade: number | null = 1,
	expectedStatus = "submitted",
	reason = "等級の登録誤り",
) =>
	rows<{ change_sheet_grade: number }>("select public.change_sheet_grade($1,$2,$3,$4,$5)", [
		id,
		grade,
		expectedGrade,
		expectedStatus,
		reason,
	]);

/** シートの、等級と共通評価以外のすべて。変わっていないことを確かめる。 */
const untouched = (id: number) =>
	rows(
		`select to_jsonb(s) - 'grade_id' - 'updated_at' as sheet,
		   (select jsonb_agg(to_jsonb(m) order by m.id) from public.milestones m where m.sheet_id = s.id) as goals,
		   (select jsonb_agg(to_jsonb(c) order by c.id) from public.sheet_corrections c where c.sheet_id = s.id) as corrections
		 from public.evaluation_sheets s where s.id = $1`,
		[id],
	);
const commonResults = (id: number) =>
	rows(
		"select item_id, first_score, second_score, first_comment from public.common_evaluation_results where sheet_id=$1 order by item_id",
		[id],
	);
const gradeOf = async (id: number) =>
	(
		await rows<{ grade_id: number | null }>(
			"select grade_id from public.evaluation_sheets where id=$1",
			[id],
		)
	)[0]?.grade_id;

beforeAll(async () => {
	db = await createProdLikeDb();
}, 60_000);
afterAll(async () => {
	await db?.close();
});
beforeEach(async () => {
	await db.exec(`reset role;
		truncate public.evaluation_sheets cascade;
		truncate public.security_audit_log;
		delete from public.evaluation_periods where id = 3;
		set session_replication_role=replica;
		update public.employees set is_enabled=true;
		insert into public.evaluation_periods (id, period_name, term_name, start_date, end_date, is_active)
		values (3, '未開始', '未開始', '2026-10-01', '2027-03-31', false);
		update public.evaluation_periods set closed_at = now() where id = 2;
		insert into public.evaluation_sheets(id,period_id,employee_id,status,primary_evaluator_id,secondary_evaluator_id,grade_id,first_overall_comment,second_overall_comment)
		values (100,1,4,'submitted',2,3,1,'一次の総評','二次の総評'),
		       (101,1,5,'submitted',2,3,1,'',''),
		       (102,1,6,'draft',2,3,1,'',''),
		       (200,2,4,'submitted',2,3,1,'',''),
		       (300,3,4,'draft',2,3,1,'','');
		insert into public.milestones(id,sheet_id,goal_number,challenge_goal,achievement,period_goals,first_score,second_score)
		values (100,100,1,'受注の手戻りを減らす','半分になった','[{"description":"手順を見直す","achievement":"済"}]',3,0),
		       (101,100,2,'教える','','[]',2,0),
		       (110,101,1,'別の人の目標','','[]',4,0);
		insert into public.common_evaluation_results(sheet_id,item_id,first_score,second_score,first_comment)
		values (100,1,3,0,'よく協力した'),(100,2,2,0,'専門性のコメント'),
		       (101,1,4,0,'別の人のコメント');
		set session_replication_role=origin;`);
});

// ----- できること -----

it("changes the grade of a current-period sheet and deletes only its common evaluation input", async () => {
	const before = await untouched(100);
	await actAs(db, 1);
	expect(await change(100, 2)).toEqual([{ change_sheet_grade: 2 }]);
	await db.exec("reset role");
	expect(await gradeOf(100)).toBe(2);
	expect(await commonResults(100)).toEqual([]);
	// シートの他の箇所(目標・期中目標・達成状況・点数・総評・状態・評価者)はそのまま
	expect(await untouched(100)).toEqual(before);
	// 他のシートの共通評価には触れない
	expect(await commonResults(101)).toEqual([
		{ item_id: 1, first_score: 4, second_score: 0, first_comment: "別の人のコメント" },
	]);
	expect(await gradeOf(101)).toBe(1);
	// 通知は送らない
	expect(await rows("select id from public.notifications")).toEqual([]);
});

it("keeps what was deleted, the grades and the reason in the audit log", async () => {
	await actAs(db, 1);
	await change(100, 2);
	await db.exec("reset role");
	const audit = await rows<{
		actor_user_id: string;
		entity_id: number;
		details: Record<string, unknown>;
	}>(
		"select actor_user_id, entity_id, details from public.security_audit_log where action='sheet.grade_change'",
	);
	expect(audit).toEqual([
		{
			actor_user_id: uid(1),
			entity_id: 100,
			details: expect.objectContaining({
				reason: "等級の登録誤り",
				actorEmployeeId: 1,
				employeeId: 4,
				periodId: 1,
				fromGradeId: 1,
				toGradeId: 2,
				deletedCommonResults: [
					expect.objectContaining({ item_id: 1, first_score: 3, first_comment: "よく協力した" }),
					expect.objectContaining({
						item_id: 2,
						first_score: 2,
						first_comment: "専門性のコメント",
					}),
				],
			}),
		},
	]);
});

it("works on a sheet with no common evaluation input yet, and reports nothing deleted", async () => {
	await actAs(db, 1);
	expect(await change(102, 2, 1, "draft")).toEqual([{ change_sheet_grade: 0 }]);
	await db.exec("reset role");
	expect(await gradeOf(102)).toBe(2);
});

it.each(["draft", "goals_submitted", "goals_confirmed", "submitted"])(
	"allows a sheet in %s (before the first evaluation is confirmed)",
	async (status) => {
		await db.exec(
			`set session_replication_role=replica; update public.evaluation_sheets set status='${status}' where id=100; set session_replication_role=origin;`,
		);
		await actAs(db, 1);
		await change(100, 2, 1, status);
		await db.exec("reset role");
		expect(await gradeOf(100)).toBe(2);
		expect(await rows("select status from public.evaluation_sheets where id=100")).toEqual([
			{ status },
		]);
	},
);

it("reports the new grade in the Admin's sheet overview", async () => {
	await actAs(db, 1);
	await change(100, 2);
	const [{ get_sheet_overview: overview }] = await rows<{
		get_sheet_overview: { id: number; gradeId: number; gradeName: string }[];
	}>("select public.get_sheet_overview()");
	expect(overview.find((row) => row.id === 100)).toMatchObject({
		gradeId: 2,
		gradeName: "等級セットなし",
	});
	expect(overview.find((row) => row.id === 101)).toMatchObject({
		gradeId: 1,
		gradeName: "一般1級",
	});
});

// ----- できないこと(すべて、何も変えずに断る) -----

const nothingChanged = async () => {
	await db.exec("reset role");
	expect(await gradeOf(100)).toBe(1);
	expect(await commonResults(100)).toHaveLength(2);
	expect(await rows("select id from public.security_audit_log")).toEqual([]);
};

it.each([0, 2, 3, 4, 5, 99])(
	"denies non-admin actor %s even through a direct RPC",
	async (actor) => {
		await actAs(db, actor);
		await expect(change(100, 2)).rejects.toMatchObject({ code: "42501" });
		await nothingChanged();
	},
);

it("denies a suspended Admin", async () => {
	await db.exec(
		"alter table public.employees disable trigger user; update public.employees set is_enabled=false where id=1; alter table public.employees enable trigger user",
	);
	await actAs(db, 1);
	await expect(change(100, 2)).rejects.toMatchObject({ code: "42501" });
	await nothingChanged();
});

it.each([
	[200, "締め済み"],
	[300, "未開始"],
])("refuses sheet %s of a period that is not the current one (%s)", async (id) => {
	await actAs(db, 1);
	await expect(change(id, 2, 1, id === 300 ? "draft" : "submitted")).rejects.toThrow(
		"当期(実施中の評価期間)のシートだけ",
	);
	await db.exec("reset role");
	expect(await gradeOf(id)).toBe(1);
	expect(await rows("select id from public.security_audit_log")).toEqual([]);
});

it.each(["first_evaluated", "finalized"])(
	"refuses a sheet whose first evaluation is confirmed (%s), so totals and ranks cannot lose their basis",
	async (status) => {
		await db.exec(
			`set session_replication_role=replica; update public.evaluation_sheets set status='${status}' where id=100; set session_replication_role=origin;`,
		);
		await actAs(db, 1);
		await expect(change(100, 2, 1, status)).rejects.toThrow("一次評価が確定したシート");
		await db.exec("reset role");
		expect(await gradeOf(100)).toBe(1);
		expect(await commonResults(100)).toHaveLength(2);
	},
);

it.each([
	["the same grade", 100, 1, 1, "submitted", "理由", "今と同じ等級"],
	["an unknown grade", 100, 999, 1, "submitted", "理由", "等級が見つかりません"],
	["no grade", 100, null, 1, "submitted", "理由", "等級を選んでください"],
	["a stale grade", 100, 2, 2, "submitted", "理由", "再読み込み"],
	["a stale status", 100, 2, 1, "draft", "理由", "再読み込み"],
	["a blank reason", 100, 2, 1, "submitted", "   ", "理由"],
	["a too long reason", 100, 2, 1, "submitted", "理".repeat(501), "理由"],
	["a missing sheet", 999, 2, 1, "submitted", "理由", "評価シートが見つかりません"],
] as const)(
	"rejects %s atomically",
	async (_, id, grade, expectedGrade, expectedStatus, reason, message) => {
		await actAs(db, 1);
		await expect(change(id, grade, expectedGrade, expectedStatus, reason)).rejects.toThrow(message);
		await nothingChanged();
	},
);

it("rolls everything back if the audit cannot be written", async () => {
	await db.exec(`create function public.reject_grade_audit() returns trigger language plpgsql as $$
		begin if new.action = 'sheet.grade_change' then raise exception 'audit failed'; end if; return new; end $$;
		create trigger reject_grade_audit before insert on public.security_audit_log for each row execute function public.reject_grade_audit();`);
	try {
		await actAs(db, 1);
		await expect(change(100, 2)).rejects.toThrow("audit failed");
		await db.exec("reset role");
		expect(await gradeOf(100)).toBe(1);
		expect(await commonResults(100)).toHaveLength(2);
	} finally {
		await db.exec(
			"reset role; drop trigger reject_grade_audit on public.security_audit_log; drop function public.reject_grade_audit()",
		);
	}
});

it("does not let anyone, Admin included, change a sheet's grade outside the RPC", async () => {
	for (const actor of [1, 2, 4]) {
		await actAs(db, actor);
		await expect(
			rows("update public.evaluation_sheets set grade_id=2 where id=100"),
		).rejects.toThrow();
	}
	await db.exec("reset role");
	expect(await gradeOf(100)).toBe(1);
});
