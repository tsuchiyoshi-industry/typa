import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	AUDIT_CATEGORIES,
	auditActionsOf,
	auditCategoryOf,
	isAuditOverride,
	KNOWN_AUDIT_ACTIONS,
} from "./AuditEvent";

// 監査ログを書くのは DB だけ(トリガーと DB 関数。操作と同じトランザクションで書き、失敗したら操作ごと取り消す)。
// 書く action の正本はマイグレーションなので、そこから読み取って照らし合わせる。
// DB に記録の種類を足したのに AuditEvent.ts に足し忘れると、ここで落ちる。
const migrations = new URL("../../../supabase/migrations/", import.meta.url);
const RECORDED_BY_DB = [
	...new Set(
		readdirSync(migrations)
			.map((file) => readFileSync(new URL(file, migrations), "utf8"))
			.filter((sql) => sql.includes("insert into public.security_audit_log"))
			.flatMap((sql) => [...sql.matchAll(/'((?:employee|sheets?)\.[a-z_]+)'/g)].map((m) => m[1])),
	),
];

it("reads the recorded actions from the migrations", () => {
	// 読み取りが壊れて 0 件になり、下の照合が素通りしないように
	expect(RECORDED_BY_DB).toContain("sheet.status");
	expect(RECORDED_BY_DB).toContain("sheet.privileged_delete");
});

describe("audit event categories", () => {
	it("knows every action the database records", () => {
		expect([...KNOWN_AUDIT_ACTIONS].sort()).toEqual([...RECORDED_BY_DB].sort());
	});

	it("puts each known action in exactly one category", () => {
		const listed = AUDIT_CATEGORIES.flatMap((category) => auditActionsOf(category));
		expect([...listed].sort()).toEqual([...RECORDED_BY_DB].sort());
		for (const action of RECORDED_BY_DB) {
			expect(auditActionsOf(auditCategoryOf(action) as never)).toContain(action);
		}
	});

	it.each([
		["employee.updated", "account"],
		["sheet.status", "workflow"],
		["sheet.privileged_delete", "override"],
		["sheet.corrected", "override"],
		["sheets.imported", "import"],
	])("files %s under %s", (action, category) => {
		expect(auditCategoryOf(action)).toBe(category);
	});

	it("keeps an action from a newer database visible as other instead of dropping it", () => {
		expect(auditCategoryOf("employee.renamed")).toBe("other");
		expect(isAuditOverride("employee.renamed")).toBe(false);
	});

	it("seals only the operations an Admin runs past the normal workflow", () => {
		expect(RECORDED_BY_DB.filter(isAuditOverride).sort()).toEqual(
			[
				"sheet.corrected",
				"sheet.grade_change",
				"sheet.privileged_delete",
				"sheet.privileged_status",
			].sort(),
		);
	});
});
