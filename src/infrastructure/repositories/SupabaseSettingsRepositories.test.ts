import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("../db/supabase", () => ({ supabase: { from: db.from, rpc: db.rpc } }));

import { EvaluationAllocation } from "../../domain/valueObjects/EvaluationAllocation";
import { SupabaseEvaluationSettingsRepository } from "./SupabaseEvaluationSettingsRepository";
import { SupabaseReviewerWorkspaceRepository } from "./SupabaseReviewerWorkspaceRepository";
import { SupabaseSheetCorrectionRepository } from "./SupabaseSheetCorrectionRepository";
import { SupabaseSheetImportRepository } from "./SupabaseSheetImportRepository";
import { SupabaseWorkspaceSettingsRepository } from "./SupabaseWorkspaceSettingsRepository";

type Result = { data: unknown; error: unknown };
const ok = (data: unknown): Result => ({ data, error: null });
const failed: Result = { data: null, error: { message: "network" } };

/** テーブルも DB 関数も、同じ結果を返す。呼ばれた操作を記録する。 */
function answer(result: Result) {
	const calls: [string, unknown[]][] = [];
	const builder = Promise.resolve(result) as Promise<Result> & Record<string, unknown>;
	for (const name of ["select", "update", "eq"]) {
		builder[name] = (...args: unknown[]) => {
			calls.push([name, args]);
			return builder;
		};
	}
	builder.maybeSingle = () => Promise.resolve(result);
	db.from.mockReturnValue(builder);
	db.rpc.mockResolvedValue(result);
	return calls;
}
beforeEach(() => {
	db.from.mockReset();
	db.rpc.mockReset();
});

const settings = new SupabaseEvaluationSettingsRepository();
const workspace = new SupabaseWorkspaceSettingsRepository();

// 読めなかった・断られたことを、既定値・空・成功と取り違えない
it.each([
	["the allocation", () => settings.findAllocation()],
	["the allocation save", () => settings.saveAllocation(EvaluationAllocation.DEFAULT)],
	["the goal limit", () => settings.findMaxChallengeGoals()],
	["the goal limit save", () => settings.saveMaxChallengeGoals(4)],
	["the company domain", () => workspace.findRequiredDomain()],
	["the SMTP summary", () => workspace.findSmtpSummary()],
	["the notification channel save", () => workspace.saveNotificationChannel("email")],
	["the import template", () => new SupabaseSheetImportRepository().findTemplate()],
	["the import", () => new SupabaseSheetImportRepository().importRows([], [], true)],
	["the reviewer's caseload", () => new SupabaseReviewerWorkspaceRepository().load(1)],
	["a closed sheet to correct", () => new SupabaseSheetCorrectionRepository().findClosedSheet(1)],
])("fails when %s meets a database error", async (_label, run) => {
	answer(failed);
	await expect(run()).rejects.toThrow("network");
});

describe("evaluation settings", () => {
	it("reads the allocation and the goal limit as they are stored", async () => {
		answer(ok({ objective_allocation: 35, common_allocation: 65 }));
		expect(await settings.findAllocation()).toEqual(EvaluationAllocation.of(35, 65));
		answer(ok({ max_challenge_goals: 6 }));
		expect(await settings.findMaxChallengeGoals()).toBe(6);
	});

	// 設定の行が無いときに、黙って 20/80 や 4 件で計算しない(基本設計 5.5)
	it.each([
		["the allocation", () => settings.findAllocation(), "配点設定が登録されていません"],
		["the goal limit", () => settings.findMaxChallengeGoals(), "上限が登録されていません"],
		[
			"the company domain",
			() => workspace.findRequiredDomain(),
			"会社ドメインの設定が登録されていません",
		],
		[
			"the closed sheet to correct",
			() => new SupabaseSheetCorrectionRepository().findClosedSheet(1),
			"評価シートが見つかりません",
		],
	])("fails instead of assuming a default when %s is missing", async (_label, run, message) => {
		answer(ok(null));
		await expect(run()).rejects.toThrow(message);
	});

	it.each([
		["the allocation", () => settings.saveAllocation(EvaluationAllocation.of(35, 65))],
		["the goal limit", () => settings.saveMaxChallengeGoals(6)],
		["the notification channel", () => workspace.saveNotificationChannel("in_app")],
	])(
		"saves %s to the single settings row, and calls a refused save not saved",
		async (_label, save) => {
			const calls = answer(ok([{ id: true }]));
			expect(await save()).toBe(true);
			expect(calls).toContainEqual(["eq", ["id", true]]);
			// 行ポリシーで断られた更新はエラーにならず 0 件で返る
			answer(ok([]));
			expect(await save()).toBe(false);
		},
	);
});

describe("workspace settings", () => {
	it("summarizes the SMTP settings for an Admin, and gives others nothing", async () => {
		const calls = answer(
			ok({
				smtp_host: "smtp.example.jp",
				smtp_port: 465,
				smtp_user: "typa@example.jp",
				smtp_password_set: true,
				smtp_verified_at: "2026-10-01T00:00:00Z",
				notification_channel: "email",
			}),
		);
		expect(await workspace.findSmtpSummary()).toEqual({
			host: "smtp.example.jp",
			port: 465,
			user: "typa@example.jp",
			passwordSet: true,
			verifiedAt: "2026-10-01T00:00:00Z",
			channel: "email",
		});
		// パスワードそのものは読まない(登録済みかどうかだけ)
		const columns = String(calls.find(([name]) => name === "select")?.[1][0])
			.split(",")
			.map((column) => column.trim());
		expect(columns).toContain("smtp_password_set");
		expect(columns).not.toContain("smtp_password");
		answer(ok(null));
		expect(await workspace.findSmtpSummary()).toBeNull();
	});
});
