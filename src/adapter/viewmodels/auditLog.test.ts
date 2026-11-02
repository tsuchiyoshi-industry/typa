import { describe, expect, it } from "vitest";
import type { AuditLogRecord } from "../../domain/repositories/AuditLogRepository";
import {
	type AuditDirectory,
	createAuditDirectory,
	describeAuditRecord,
	groupByDay,
} from "./auditLog";

const TZ = "Asia/Tokyo";
const directory: AuditDirectory = createAuditDirectory({
	people: [
		{ id: 1, userId: "u-admin", name: "管理 太郎", employeeNo: "A001" },
		{ id: 2, userId: "u-first", name: "一次 花子", employeeNo: "R002" },
		{ id: 3, userId: "u-second", name: "二次 次郎", employeeNo: "R003" },
		{ id: 4, userId: "u-subject", name: "山田 花子", employeeNo: "E004" },
		{ id: 7, userId: null, name: "佐藤 一郎", employeeNo: "E007" },
	],
	roles: new Map([
		[1, "Employee"],
		[2, "Reviewer"],
		[3, "Admin"],
	]),
	grades: [
		{ id: 1, name: "一般1級" },
		{ id: 2, name: "一般2級" },
	],
	periods: [
		{ id: 10, periodName: "26期 上期" },
		{ id: 9, periodName: "25期 下期" },
	],
	sheets: [{ id: 100, employeeId: 4, periodId: 10, periodName: "26期 上期" }],
});
const record = (overrides: Partial<AuditLogRecord>): AuditLogRecord => ({
	id: 1,
	occurredAt: "2026-11-02T05:03:09Z",
	actorUserId: "u-admin",
	action: "sheet.status",
	entityId: 100,
	details: {},
	...overrides,
});
const describe_ = (overrides: Partial<AuditLogRecord>) =>
	describeAuditRecord(record(overrides), directory, TZ);
const admin = { name: "管理 太郎", employeeNo: "A001" };
const subject = { name: "山田 花子", employeeNo: "E004" };

describe("who acted and when", () => {
	it("shows local time and the day it belongs to", () => {
		// 15:30 UTC は日本時間の翌日 0:30
		expect(describe_({ occurredAt: "2026-11-01T15:30:00Z" })).toMatchObject({
			day: "2026-11-02",
			time: "00:30",
		});
	});

	it("names the employee behind the account", () => {
		expect(describe_({ actorUserId: "u-first" }).actor).toEqual({
			name: "一次 花子",
			employeeNo: "R002",
		});
	});

	it("falls back to the employee ID an Admin operation records, once the account is gone", () => {
		expect(
			describe_({
				actorUserId: "u-removed",
				action: "sheet.privileged_status",
				details: { actorEmployeeId: 1, from: "finalized", to: "first_evaluated", reason: "誤確定" },
			}).actor,
		).toEqual(admin);
	});

	it("does not invent a name for an account it cannot find", () => {
		expect(describe_({ actorUserId: "u-removed" }).actor).toEqual({
			name: "不明なアカウント",
			employeeNo: null,
		});
	});

	it("calls a record without an account the system", () => {
		expect(describe_({ actorUserId: null }).actor).toEqual({ name: "システム", employeeNo: null });
	});
});

describe("sheet records", () => {
	it("names the step of a normal transition and links to the sheet", () => {
		expect(
			describe_({ details: { from: "goals_submitted", to: "goals_confirmed" } }),
		).toMatchObject({
			category: "workflow",
			title: "目標を確定",
			seal: null,
			subject: { person: subject, periodName: "26期 上期", sheetId: 100, missing: null },
			changes: [{ label: "状態", before: "目標確認待ち", after: "振り返り待ち" }],
			reason: null,
		});
	});

	it.each([
		["draft", "goals_submitted", "目標を送信"],
		["goals_confirmed", "submitted", "一次評価を依頼"],
		["submitted", "first_evaluated", "一次評価を確定"],
		["first_evaluated", "finalized", "評価を確定"],
	])("names %s → %s with the words of the app's button (%s)", (from, to, title) => {
		expect(describe_({ details: { from, to } }).title).toBe(title);
	});

	it("calls a step backwards a return, whatever the target step is", () => {
		// 一次評価者の通常の差し戻しは、画面と同じ「要修正」
		expect(describe_({ details: { from: "goals_submitted", to: "draft" } }).title).toBe(
			"目標を要修正として戻す",
		);
		// それ以外で下書きへ戻るのは、遡及処理の状態変更だけ
		expect(describe_({ details: { from: "finalized", to: "draft" } }).title).toBe("下書きに戻す");
		expect(describe_({ details: { from: "finalized", to: "submitted" } }).title).toBe(
			"一次評価待ちに戻す",
		);
	});

	it("keeps a status the app does not know as written", () => {
		expect(describe_({ details: { from: "draft", to: "archived" } }).changes).toEqual([
			{ label: "状態", before: "下書き", after: "archived" },
		]);
	});

	it("seals a privileged status change and shows its reason", () => {
		expect(
			describe_({
				action: "sheet.privileged_status",
				details: { from: "finalized", to: "first_evaluated", reason: "二次評価者の誤確定" },
			}),
		).toMatchObject({
			category: "override",
			title: "状態を特権で変更",
			seal: { glyph: "特", label: "特権での状態変更" },
			changes: [{ label: "状態", before: "評価確定", after: "二次評価待ち" }],
			reason: "二次評価者の誤確定",
		});
	});

	it("names a deleted sheet from the details, without a link, and counts what went with it", () => {
		const entry = describe_({
			action: "sheet.privileged_delete",
			entityId: 555,
			details: {
				employeeId: 4,
				periodId: 9,
				from: "draft",
				reason: "二重に作成したため",
				snapshot: { goals: [{}, {}, {}], commonResults: [{}], corrections: [] },
			},
		});
		expect(entry).toMatchObject({
			title: "シートを削除",
			seal: { glyph: "削" },
			subject: { person: subject, periodName: "25期 下期", sheetId: null, missing: null },
			reason: "二重に作成したため",
		});
		expect(entry.facts).toEqual([
			{ label: "削除した目標", value: "3件" },
			{ label: "削除した共通評価", value: "1件" },
			{ label: "削除した締め後修正", value: "0件" },
		]);
	});

	it("says a sheet is gone when nothing names it any more", () => {
		expect(
			describe_({ entityId: 555, details: { from: "draft", to: "goals_submitted" } }).subject,
		).toEqual({
			person: null,
			periodName: null,
			sheetId: null,
			missing: "削除されたシート（ID 555）",
		});
	});

	it("shows the grade change and how many common evaluation inputs it removed", () => {
		const entry = describe_({
			action: "sheet.grade_change",
			details: {
				employeeId: 4,
				periodId: 10,
				fromGradeId: 1,
				toGradeId: 2,
				reason: "昇格の反映漏れ",
				deletedCommonResults: [{}, {}],
			},
		});
		expect(entry).toMatchObject({
			title: "作成時の等級を変更",
			seal: { glyph: "級" },
			changes: [{ label: "等級", before: "一般1級", after: "一般2級" }],
			facts: [{ label: "削除した共通評価の入力", value: "2件" }],
		});
	});

	it("shows how many fields a correction after the close changed", () => {
		expect(
			describe_({ action: "sheet.corrected", details: { changes: 4, reason: "転記ミス" } }),
		).toMatchObject({
			title: "締め後修正",
			seal: { glyph: "訂" },
			facts: [{ label: "直した項目", value: "4件" }],
			reason: "転記ミス",
		});
	});
});

describe("employee records", () => {
	const updated = (fields: Record<string, [unknown, unknown]>, actorUserId = "u-admin") =>
		describe_({
			actorUserId,
			action: "employee.updated",
			entityId: 4,
			details: {
				changedFields: Object.keys(fields),
				before: Object.fromEntries(Object.entries(fields).map(([k, [b]]) => [k, b])),
				after: Object.fromEntries(Object.entries(fields).map(([k, [, a]]) => [k, a])),
			},
		});

	it("translates IDs into the names an Admin knows", () => {
		const entry = updated({
			role_id: [1, 2],
			primary_evaluator_id: [null, 2],
			secondary_evaluator_id: [3, 99],
			grade_id: [1, 2],
		});
		expect(entry.category).toBe("account");
		expect(entry.title).toBe("権限を変更");
		expect(entry.subject).toEqual({
			person: subject,
			periodName: null,
			sheetId: null,
			missing: null,
		});
		expect(entry.changes).toEqual([
			{ label: "権限", before: "Employee", after: "Reviewer" },
			{ label: "一次評価者", before: "未設定", after: "一次 花子" },
			{ label: "二次評価者", before: "二次 次郎", after: "社員 ID 99" },
			{ label: "等級", before: "一般1級", after: "一般2級" },
		]);
	});

	it.each([
		[
			{ is_enabled: [true, false] },
			"利用を停止",
			{ label: "利用", before: "利用中", after: "停止中" },
		],
		[
			{ is_enabled: [false, true] },
			"利用を再開",
			{ label: "利用", before: "停止中", after: "利用中" },
		],
		[
			{ keep_signed_in: [false, true] },
			"ログイン状態の保持を変更",
			{ label: "ログイン状態", before: "閉じたらログアウト", after: "保持する" },
		],
		[
			{ no_secondary_evaluator: [false, true] },
			"評価者を変更",
			{ label: "二次評価者の有無", before: "置く", after: "置かない" },
		],
		[
			{ name: ["山田 花", "山田 花子"] },
			"社員の情報を変更",
			{ label: "氏名", before: "山田 花", after: "山田 花子" },
		],
	] as const)("titles %j as %s", (fields, title, change) => {
		const entry = updated(fields as never);
		expect(entry.title).toBe(title);
		expect(entry.changes).toEqual([change]);
	});

	it("tells a registration (done by the employee) from its reset (done by an Admin)", () => {
		const linked = (actor: string) =>
			describe_({
				actorUserId: actor,
				action: "employee.updated",
				entityId: 4,
				details: { changedFields: ["user_id"], before: {}, after: {} },
			});
		expect(linked("u-subject").title).toBe("アカウントを登録");
		expect(linked("u-admin").title).toBe("登録を取り消し");
		expect(linked("u-subject").changes).toEqual([]);
	});

	it("shows a field it has no name for, as written", () => {
		expect(updated({ shoe_size: [26, 27] }).changes).toEqual([
			{ label: "shoe_size", before: "26", after: "27" },
		]);
	});

	it.each([
		["employee.invited", "招待コードを発行"],
		["employee.pre_registered", "社員を事前登録"],
	])("names %s", (action, title) => {
		expect(describe_({ action, entityId: 7, details: { employeeNo: "E007" } })).toMatchObject({
			title,
			seal: null,
			subject: { person: { name: "佐藤 一郎", employeeNo: "E007" } },
		});
	});
});

it("summarizes an import by the period and its counts", () => {
	expect(
		describe_({
			action: "sheets.imported",
			entityId: 10,
			details: {
				periodName: "26期 上期",
				employees: 12,
				newSheets: 10,
				replacedSheets: 2,
				goals: 40,
				commonResults: 96,
			},
		}),
	).toMatchObject({
		category: "import",
		title: "評価データを取込",
		subject: { person: null, periodName: "26期 上期", sheetId: null, missing: null },
		facts: [
			{ label: "社員", value: "12人" },
			{ label: "新しいシート", value: "10件" },
			{ label: "置き換えたシート", value: "2件" },
			{ label: "目標", value: "40件" },
			{ label: "共通評価", value: "96件" },
		],
	});
});

it("shows an action from a newer database as written, with its record", () => {
	const entry = describe_({ action: "period.renamed", entityId: 3, details: { to: "27期" } });
	expect(entry).toMatchObject({ category: "other", title: "period.renamed", seal: null });
	expect(JSON.parse(entry.raw)).toEqual({ to: "27期" });
});

it("does not trust the shape of details", () => {
	const entry = describe_({
		action: "sheet.privileged_delete",
		entityId: 1,
		details: { employeeId: "4; drop", reason: 42, snapshot: "broken" },
	});
	expect(entry.reason).toBeNull();
	expect(entry.subject?.person).toBeNull();
	expect(entry.facts).toEqual([]);
});

it("groups entries by day, newest day first, keeping their order", () => {
	const entries = [
		record({ id: 3, occurredAt: "2026-11-02T01:00:00Z" }),
		record({ id: 2, occurredAt: "2026-11-01T16:00:00Z" }),
		record({ id: 1, occurredAt: "2026-11-01T14:00:00Z" }),
	].map((r) => describeAuditRecord(r, directory, TZ));
	expect(groupByDay(entries).map((day) => [day.day, day.entries.map((e) => e.id)])).toEqual([
		["2026-11-02", [3, 2]],
		["2026-11-01", [1]],
	]);
	expect(groupByDay(entries)[0].label).toBe("2026年11月2日（月）");
});
