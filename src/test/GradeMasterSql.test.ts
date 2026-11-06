import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { actAs, createProdLikeDb, uid } from "./prodLikeDb";

// 等級と共通目標のマスタ(Admin だけ)。シートは作成時の等級の共通目標セットを持ち続けるので、
// マスタを直しても既存のシートには及ばない。既存のシートが使うセットを直すと、DB が複製を新版にし、
// そのセットを使っていた等級を新版へ付け替える(旧版は既存のシートのために残す)。
let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
	(await db.query<T>(sql, params)).rows;

type Item = { id?: number | null; title: string; description: string; weight: number };
type Master = {
	grades: {
		id: number;
		name: string;
		itemSetId: number | null;
		employeeCount: number;
		sheetCount: number;
	}[];
	itemSets: {
		id: number;
		name: string;
		sheetCount: number;
		items: Required<Item>[];
	}[];
};

const master = async () =>
	(await rows<{ get_grade_master: Master }>("select public.get_grade_master()"))[0]
		.get_grade_master;
const saveGrade = async (
	id: number | null,
	name: string,
	itemSet: number | null,
	expectedName: string | null = null,
	expectedSet: number | null = null,
) =>
	(
		await rows<{ id: number }>("select public.save_employee_grade($1,$2,$3,$4,$5) as id", [
			id,
			name,
			itemSet,
			expectedName,
			expectedSet,
		])
	)[0].id;
const deleteGrade = (id: number, expectedName: string) =>
	rows("select public.delete_employee_grade($1,$2)", [id, expectedName]);
const saveSet = async (
	id: number | null,
	name: string,
	items: Item[],
	expected: { name: string; items: Required<Item>[] } | null = null,
) =>
	(
		await rows<{ id: number }>(
			"select public.save_common_evaluation_item_set($1,$2,$3::jsonb,$4::jsonb) as id",
			[id, name, JSON.stringify(items), expected && JSON.stringify(expected)],
		)
	)[0].id;
const deleteSet = (id: number, expectedName: string) =>
	rows("select public.delete_common_evaluation_item_set($1,$2)", [id, expectedName]);

/** 今の内容(画面が読み込んだもの)。保存のときに「見ていた内容」として送る。 */
const loaded = async (id: number) => {
	await actAs(db, 1);
	const set = (await master()).itemSets.find((s) => s.id === id);
	if (!set) {
		throw new Error(`set ${id} is not listed`);
	}
	return { name: set.name, items: set.items };
};
/** シートに表示される共通評価の項目(本人として読む)。 */
const sheetItems = async (sheetId: number, employee = 4) => {
	await actAs(db, employee);
	const [{ doc }] = await rows<{ doc: { commonResults: { title: string; weight: number }[] } }>(
		"select public.get_sheet($1) as doc",
		[sheetId],
	);
	await db.exec("reset role");
	return doc.commonResults.map((r) => `${r.title}:${r.weight}`);
};
/** マスタの3つの表のすべて。断ったときに何も変わっていないことを確かめる。 */
const snapshot = () =>
	rows(`select
		(select jsonb_agg(to_jsonb(g) order by g.id) from public.employee_grades g) as grades,
		(select jsonb_agg(to_jsonb(s) order by s.id) from public.common_evaluation_item_sets s) as sets,
		(select jsonb_agg(to_jsonb(i) order by i.id) from public.common_evaluation_items i) as items,
		(select jsonb_agg(jsonb_build_array(s.id, s.grade_id, s.item_set_id) order by s.id) from public.evaluation_sheets s) as sheets,
		(select count(*) from public.security_audit_log) as audits`);
const audits = () =>
	rows<{
		actor_user_id: string;
		action: string;
		entity_id: number;
		details: Record<string, unknown>;
	}>("select actor_user_id, action, entity_id, details from public.security_audit_log order by id");

beforeAll(async () => {
	db = await createProdLikeDb();
}, 60_000);
afterAll(async () => {
	await db?.close();
});
beforeEach(async () => {
	// 等級 1 はセット 1(協調性 2・専門性 3)。等級 3 はセット 2(未使用。シートがない)。
	// シート 100 は等級 1 で作られた本人(社員 4)のシート。
	await db.exec(`reset role;
		truncate public.evaluation_sheets cascade;
		truncate public.security_audit_log;
		set session_replication_role=replica;
		update public.employees set is_enabled=true, grade_id=1;
		delete from public.employee_grades where id >= 3;
		delete from public.common_evaluation_items where id >= 3;
		delete from public.common_evaluation_item_sets where id >= 2;
		update public.common_evaluation_items set title = case id when 1 then '協調性' else '専門性' end,
		  description = case id when 1 then '全等級に共通' else '一般だけ' end, weight = case id when 1 then 2 else 3 end;
		update public.common_evaluation_item_sets set name = '一般' where id = 1;
		update public.employee_grades set item_set_id = case id when 1 then 1 end, grade_name = case id when 1 then '一般1級' else '等級セットなし' end;
		insert into public.common_evaluation_item_sets (id, name) values (2, '未使用');
		insert into public.common_evaluation_items (id, title, description, weight, item_set_id) values (3, '品質', '説明', 1, 2);
		insert into public.employee_grades (id, grade_name, item_set_id) values (3, '技能1級', 2);
		set session_replication_role=origin;
		alter table public.employee_grades alter column id restart with 100;
		alter table public.common_evaluation_item_sets alter column id restart with 100;
		alter table public.common_evaluation_items alter column id restart with 100;
		insert into public.evaluation_sheets (id, period_id, employee_id) values (100, 1, 4);`);
});

// ----- シートは作成時の共通目標を持ち続ける -----

it("records the grade's item set on a new sheet, and the client cannot choose it", async () => {
	await actAs(db, 5);
	await expect(
		rows(
			"insert into public.evaluation_sheets (period_id, employee_id, item_set_id) values (1, 5, 2)",
		),
	).rejects.toThrow("permission denied");
	await rows("insert into public.evaluation_sheets (period_id, employee_id) values (1, 5)");
	await db.exec("reset role");
	expect(
		await rows(
			"select item_set_id from public.evaluation_sheets where employee_id in (4, 5) order by id",
		),
	).toEqual([{ item_set_id: 1 }, { item_set_id: 1 }]);
});

it("keeps an existing sheet's common goals when the items of its set are corrected", async () => {
	const before = await loaded(1);
	const next = await saveSet(
		1,
		"一般",
		[
			{ id: 1, title: "協調性(直した)", description: "全等級に共通", weight: 1 },
			{ id: 2, title: "専門性", description: "一般だけ", weight: 3 },
			{ title: "安全", description: "足した", weight: 2 },
		],
		before,
	);
	// 既存のシートが使うセットは、複製を新版にする
	expect(next).not.toBe(1);
	expect(await sheetItems(100)).toEqual(["協調性:2", "専門性:3"]);
	// 等級は新版を指し、これから作るシートは新版になる
	await db.exec(
		"insert into public.evaluation_sheets (id, period_id, employee_id) values (101, 1, 5)",
	);
	expect(await sheetItems(101, 5)).toEqual(["協調性(直した):1", "専門性:3", "安全:2"]);
	await actAs(db, 1);
	const after = await master();
	expect(after.grades.find((g) => g.id === 1)?.itemSetId).toBe(next);
	// 旧版はシートのために残すが、マスタには出さない
	expect(after.itemSets.map((s) => s.id)).toEqual([2, next]);
	await db.exec("reset role");
	expect(
		await rows(
			"select count(*)::int as n from public.common_evaluation_items where item_set_id = 1",
		),
	).toEqual([{ n: 2 }]);
});

it("keeps an existing sheet's common goals when its grade is moved to another set", async () => {
	await actAs(db, 1);
	await saveGrade(1, "一般1級", 2, "一般1級", 1);
	expect(await sheetItems(100)).toEqual(["協調性:2", "専門性:3"]);
	await db.exec(
		"insert into public.evaluation_sheets (id, period_id, employee_id) values (101, 1, 5)",
	);
	expect(await sheetItems(101, 5)).toEqual(["品質:1"]);
});

it("scores, saves and checks an existing sheet on the items it was created with", async () => {
	await saveSet(
		1,
		"一般",
		[{ title: "新しい項目", description: "説明", weight: 5 }],
		await loaded(1),
	);
	const newItem = (
		await rows<{ id: number }>(
			"select id from public.common_evaluation_items where title = '新しい項目'",
		)
	)[0].id;
	await db.exec(
		`reset role; set session_replication_role=replica;
		 update public.evaluation_sheets set status = 'submitted', primary_evaluator_id = 2 where id = 100;
		 set session_replication_role=origin;`,
	);
	await actAs(db, 2);
	await expect(
		rows("select public.save_common_evaluation(100, $1::jsonb)", [
			JSON.stringify([{ itemId: newItem, firstScore: 4, firstComment: "" }]),
		]),
	).rejects.toThrow("評価項目または点数が正しくありません");
	await rows("select public.save_common_evaluation(100, $1::jsonb)", [
		JSON.stringify([
			{ itemId: 1, firstScore: 4, firstComment: "" },
			{ itemId: 2, firstScore: 4, firstComment: "" },
		]),
	]);
	// 2 項目とも満点なので、共通評価の配点をすべて得る(新しい項目は数えない)
	const [{ score }] = await rows<{ score: number }>(
		"select public.sheet_evaluation_score(100, true, 0, 100) as score",
	);
	expect(score).toBe(100);
});

it("imports into a draft sheet on its own items, and into a new sheet on the grade's current items", async () => {
	await actAs(db, 1);
	await saveGrade(1, "一般1級", 2, "一般1級", 1);
	const [{ template }] = await rows<{
		template: { employees: { employeeNo: string; items: { id: number }[] }[] };
	}>("select public.get_sheet_import_template() as template");
	const itemsOf = (no: string) =>
		template.employees.find((e) => e.employeeNo === no)?.items.map((i) => i.id);
	expect(itemsOf("E4")).toEqual([1, 2]);
	expect(itemsOf("E5")).toEqual([3]);
	const check = async (employeeNo: string, itemId: string) =>
		(
			await rows<{ result: { errors: { message: string }[] } }>(
				"select public.import_sheet_data('[]'::jsonb, $1::jsonb, false) as result",
				[JSON.stringify([{ line: 2, employeeNo, itemId, firstScore: "3" }])],
			)
		)[0].result.errors.map((e) => e.message);
	expect(await check("E4", "1")).toEqual([]);
	expect(await check("E4", "3")).toEqual([
		expect.stringContaining("この社員の等級の共通評価項目ではありません"),
	]);
	expect(await check("E5", "3")).toEqual([]);
});

it("edits a set that no sheet uses in place, keeping its item ids", async () => {
	const before = await loaded(2);
	expect(
		await saveSet(
			2,
			"技能",
			[
				{ id: 3, title: "品質", description: "直した", weight: 2 },
				{ title: "安全", description: "", weight: 1 },
			],
			before,
		),
	).toBe(2);
	await db.exec("reset role");
	expect(
		await rows(
			"select id, title, description, weight from public.common_evaluation_items where item_set_id = 2 order by id",
		),
	).toEqual([
		{ id: 3, title: "品質", description: "直した", weight: 2 },
		{ id: 100, title: "安全", description: "", weight: 1 },
	]);
	// 外した項目は消える
	await saveSet(
		2,
		"技能",
		[{ id: 100, title: "安全", description: "", weight: 1 }],
		await loaded(2),
	);
	await db.exec("reset role");
	expect(await rows("select id from public.common_evaluation_items where item_set_id = 2")).toEqual(
		[{ id: 100 }],
	);
});

it("renames a set that sheets use without copying it, since sheets do not show the set's name", async () => {
	expect(await saveSet(1, "一般(改)", (await loaded(1)).items, await loaded(1))).toBe(1);
	await db.exec("reset role");
	expect(await rows("select name from public.common_evaluation_item_sets where id = 1")).toEqual([
		{ name: "一般(改)" },
	]);
});

it("points a corrected sheet grade at the new grade's current set", async () => {
	await actAs(db, 1);
	await rows(
		"select public.change_sheet_grade(100, 3::smallint, 1::smallint, 'draft', '登録誤り')",
	);
	expect(await sheetItems(100)).toEqual(["品質:1"]);
});

// ----- 等級の追加・変更・削除 -----

it("adds, renames and re-points a grade, auditing before and after", async () => {
	await actAs(db, 1);
	const id = await saveGrade(null, "  総合1級 ", 2);
	await saveGrade(id, "総合Ⅰ級", 1, "総合1級", 2);
	const grade = (await master()).grades.find((g) => g.id === id);
	expect(grade).toEqual({ id, name: "総合Ⅰ級", itemSetId: 1, employeeCount: 0, sheetCount: 0 });
	await db.exec("reset role");
	expect(await audits()).toEqual([
		{
			actor_user_id: uid(1),
			action: "grade.saved",
			entity_id: id,
			details: { before: null, after: { name: "総合1級", itemSetId: 2, itemSetName: "未使用" } },
		},
		{
			actor_user_id: uid(1),
			action: "grade.saved",
			entity_id: id,
			details: {
				before: { name: "総合1級", itemSetId: 2, itemSetName: "未使用" },
				after: { name: "総合Ⅰ級", itemSetId: 1, itemSetName: "一般" },
			},
		},
	]);
});

it("counts the employees and sheets of each grade and the sheets of each set", async () => {
	await actAs(db, 1);
	const { grades, itemSets } = await master();
	expect(grades).toEqual([
		{ id: 1, name: "一般1級", itemSetId: 1, employeeCount: 7, sheetCount: 1 },
		{ id: 2, name: "等級セットなし", itemSetId: null, employeeCount: 0, sheetCount: 0 },
		{ id: 3, name: "技能1級", itemSetId: 2, employeeCount: 0, sheetCount: 0 },
	]);
	expect(itemSets).toEqual([
		{
			id: 1,
			name: "一般",
			sheetCount: 1,
			items: [
				{ id: 1, title: "協調性", description: "全等級に共通", weight: 2 },
				{ id: 2, title: "専門性", description: "一般だけ", weight: 3 },
			],
		},
		{
			id: 2,
			name: "未使用",
			sheetCount: 0,
			items: [{ id: 3, title: "品質", description: "説明", weight: 1 }],
		},
	]);
});

it("deletes a grade nobody holds and no sheet was made with, keeping it in the audit", async () => {
	await actAs(db, 1);
	await deleteGrade(3, "技能1級");
	expect((await master()).grades.map((g) => g.id)).toEqual([1, 2]);
	await db.exec("reset role");
	expect((await audits())[0]).toMatchObject({
		action: "grade.deleted",
		entity_id: 3,
		details: { deleted: { name: "技能1級", itemSetId: 2, itemSetName: "未使用" } },
	});
});

// ----- 共通目標セットの追加・削除 -----

it("adds a set with its items and deletes it while no grade or sheet uses it", async () => {
	await actAs(db, 1);
	const id = await saveSet(null, " 管理職 ", [
		{ title: "判断", description: "決める", weight: 2 },
		{ title: "育成", description: "育てる", weight: 1 },
	]);
	expect((await master()).itemSets.find((s) => s.id === id)).toMatchObject({
		name: "管理職",
		sheetCount: 0,
		items: [
			{ title: "判断", description: "決める", weight: 2 },
			{ title: "育成", description: "育てる", weight: 1 },
		],
	});
	await deleteSet(id, "管理職");
	await db.exec("reset role");
	expect(
		await rows("select id from public.common_evaluation_items where item_set_id = $1", [id]),
	).toEqual([]);
	expect((await audits()).map((a) => a.action)).toEqual([
		"common_goals.saved",
		"common_goals.deleted",
	]);
	expect((await audits())[1].details).toMatchObject({
		deleted: { name: "管理職", items: [{ title: "判断" }, { title: "育成" }] },
	});
});

it("audits a copied set with the previous version and the sheets that keep it", async () => {
	const next = await saveSet(
		1,
		"一般",
		[{ title: "一つだけ", description: "説明", weight: 1 }],
		await loaded(1),
	);
	await db.exec("reset role");
	expect((await audits())[0]).toMatchObject({
		action: "common_goals.saved",
		entity_id: next,
		details: {
			previousItemSetId: 1,
			copiedForSheets: 1,
			before: { name: "一般", items: [{ title: "協調性" }, { title: "専門性" }] },
			after: { name: "一般", items: [{ title: "一つだけ" }] },
		},
	});
});

// ----- できないこと(すべて、何も変えずに断る) -----

const refused = async (run: () => Promise<unknown>, message: string | RegExp) => {
	await db.exec("reset role");
	const before = await snapshot();
	await actAs(db, 1);
	await expect(run()).rejects.toThrow(message);
	await db.exec("reset role");
	expect(await snapshot()).toEqual(before);
};

it.each([
	["a blank grade name", () => saveGrade(null, "  ", 1), "等級名"],
	["a too long grade name", () => saveGrade(null, "級".repeat(51), 1), "等級名"],
	["a duplicate grade name", () => saveGrade(null, "一般1級", 1), "すでにあります"],
	["a grade without a set", () => saveGrade(null, "総合1級", null), "共通目標を選んで"],
	["an unknown set", () => saveGrade(null, "総合1級", 999), "共通目標が見つかりません"],
	["a missing grade", () => saveGrade(999, "総合1級", 1, "x", 1), "等級が見つかりません"],
	["a stale grade name", () => saveGrade(3, "技能Ⅰ級", 2, "技能一級", 2), "再読み込み"],
	["a stale grade set", () => saveGrade(3, "技能Ⅰ級", 2, "技能1級", 1), "再読み込み"],
	["deleting a held grade", () => deleteGrade(1, "一般1級"), "社員が 7 人"],
	["deleting a stale grade", () => deleteGrade(3, "技能一級"), "再読み込み"],
	["deleting a missing grade", () => deleteGrade(999, "x"), "等級が見つかりません"],
] as const)("refuses %s", async (_, run, message) => {
	await refused(run, message);
});

it("refuses to delete a grade that sheets were made with, even when nobody holds it now", async () => {
	await db.exec(
		"alter table public.employees disable trigger user; update public.employees set grade_id = 3; alter table public.employees enable trigger user",
	);
	await refused(() => deleteGrade(1, "一般1級"), "評価シートが 1 枚");
});

const item = { title: "品質", description: "説明", weight: 1 };
it.each([
	["a blank set name", () => saveSet(null, " ", [item]), "名前"],
	["a set without items", () => saveSet(null, "空", []), "1 件以上"],
	[
		"items that are not a list",
		() => rows("select public.save_common_evaluation_item_set(null,'x','{}'::jsonb,null)"),
		"1 件以上",
	],
	["a blank title", () => saveSet(null, "x", [{ ...item, title: " " }]), "項目名"],
	["a too long title", () => saveSet(null, "x", [{ ...item, title: "項".repeat(101) }]), "項目名"],
	[
		"a too long description",
		() => saveSet(null, "x", [{ ...item, description: "説".repeat(1001) }]),
		"説明",
	],
	["a weight of 0", () => saveSet(null, "x", [{ ...item, weight: 0 }]), "重み"],
	["a weight of 11", () => saveSet(null, "x", [{ ...item, weight: 11 }]), "重み"],
	["a fractional weight", () => saveSet(null, "x", [{ ...item, weight: 1.5 }]), "重み"],
	["duplicate titles", () => saveSet(null, "x", [item, { ...item }]), "重複"],
	[
		"too many items",
		() =>
			saveSet(
				null,
				"x",
				Array.from({ length: 31 }, (_, i) => ({ ...item, title: `項目${i}` })),
			),
		"30 件",
	],
	[
		"an item of another set",
		async () => saveSet(2, "未使用", [{ ...item, id: 1 }], await loaded(2)),
		"このセットの項目ではありません",
	],
	[
		"a stale set",
		async () => saveSet(2, "未使用", [item], { ...(await loaded(2)), name: "古い名前" }),
		"再読み込み",
	],
	[
		"a stale item",
		async () => {
			const before = await loaded(2);
			return saveSet(2, "未使用", [item], {
				...before,
				items: [{ ...before.items[0], weight: 9 }],
			});
		},
		"再読み込み",
	],
	["saving a set without what was shown", () => saveSet(2, "未使用", [item], null), "再読み込み"],
	[
		"a missing set",
		() => saveSet(999, "x", [item], { name: "x", items: [] }),
		"共通目標が見つかりません",
	],
	["deleting a set a grade uses", () => deleteSet(2, "未使用"), "技能1級"],
	["deleting a stale set", () => deleteSet(2, "古い名前"), "再読み込み"],
] as const)("refuses %s", async (_, run, message) => {
	await refused(run, message);
});

it("keeps a superseded set for its sheets: it cannot be edited, deleted or listed", async () => {
	const old = await loaded(1);
	const next = await saveSet(1, "一般", [item], old);
	expect(next).not.toBe(1);
	await refused(() => saveSet(1, "一般", [item], old), "過去の評価シートの記録");
	await refused(() => deleteSet(1, "一般"), "評価シートが 1 枚");
});

it.each([0, 2, 3, 4, 5, 99])("denies non-admin actor %s every master function", async (actor) => {
	const before = await snapshot();
	await actAs(db, actor);
	for (const run of [
		() => master(),
		() => saveGrade(null, "総合1級", 1),
		() => saveGrade(3, "x", 2, "技能1級", 2),
		() => deleteGrade(3, "技能1級"),
		() => saveSet(null, "x", [item]),
		() =>
			saveSet(2, "x", [item], { name: "未使用", items: [{ id: 3, ...item, description: "説明" }] }),
		() => deleteSet(2, "未使用"),
	]) {
		await expect(run()).rejects.toMatchObject({ code: "42501" });
	}
	await db.exec("reset role");
	expect(await snapshot()).toEqual(before);
});

it("denies a suspended Admin", async () => {
	await db.exec(
		"alter table public.employees disable trigger user; update public.employees set is_enabled=false where id=1; alter table public.employees enable trigger user",
	);
	const before = await snapshot();
	await actAs(db, 1);
	await expect(master()).rejects.toMatchObject({ code: "42501" });
	await expect(saveGrade(null, "総合1級", 1)).rejects.toMatchObject({ code: "42501" });
	await expect(saveSet(null, "x", [item])).rejects.toMatchObject({ code: "42501" });
	await db.exec("reset role");
	expect(await snapshot()).toEqual(before);
});

it.each([
	["grade.saved", "", () => saveGrade(3, "技能Ⅰ級", 1, "技能1級", 2)],
	["grade.deleted", "", () => deleteGrade(3, "技能1級")],
	["common_goals.saved", "", async () => saveSet(1, "一般", [item], await loaded(1))],
	// 等級が使っていないセットにしてから消す
	[
		"common_goals.deleted",
		"update public.employee_grades set item_set_id = 1 where id = 3",
		() => deleteSet(2, "未使用"),
	],
] as const)("rolls %s back if the audit cannot be written", async (action, prepare, run) => {
	await db.exec(`${prepare};
		create function public.reject_master_audit() returns trigger language plpgsql as $$
		begin if new.action = '${action}' then raise exception 'audit failed'; end if; return new; end $$;
		create trigger reject_master_audit before insert on public.security_audit_log for each row execute function public.reject_master_audit();`);
	try {
		const before = await snapshot();
		await actAs(db, 1);
		await expect(run()).rejects.toThrow("audit failed");
		await db.exec("reset role");
		expect(await snapshot()).toEqual(before);
	} finally {
		await db.exec(
			"reset role; drop trigger reject_master_audit on public.security_audit_log; drop function public.reject_master_audit()",
		);
	}
});

it("does not let anyone, Admin included, write the master tables or a sheet's set outside the functions", async () => {
	const before = await snapshot();
	for (const actor of [1, 4]) {
		await actAs(db, actor);
		for (const sql of [
			"update public.employee_grades set grade_name = 'x'",
			"insert into public.employee_grades (grade_name) values ('x')",
			"delete from public.employee_grades where id = 3",
			"update public.common_evaluation_items set title = 'x'",
			"insert into public.common_evaluation_items (title, description, item_set_id) values ('x', 'x', 2)",
			"delete from public.common_evaluation_items where id = 3",
			"update public.common_evaluation_item_sets set name = 'x'",
			"insert into public.common_evaluation_item_sets (name) values ('x')",
			"update public.evaluation_sheets set item_set_id = 2 where id = 100",
		]) {
			await expect(rows(sql), sql).rejects.toThrow();
		}
	}
	await db.exec("reset role");
	expect(await snapshot()).toEqual(before);
});

it("does not let even the database owner change the items of a set that sheets use", async () => {
	await expect(
		rows("update public.common_evaluation_items set title = 'x' where id = 1"),
	).rejects.toThrow("評価シートで使われている");
	await expect(rows("delete from public.common_evaluation_items where id = 2")).rejects.toThrow(
		"評価シートで使われている",
	);
	await expect(
		rows(
			"insert into public.common_evaluation_items (title, description, item_set_id) values ('x', 'x', 1)",
		),
	).rejects.toThrow("評価シートで使われている");
	await expect(
		rows(
			"insert into public.common_evaluation_items (title, description, item_set_id) values ('x', 'x', null)",
		),
	).rejects.toThrow();
});
