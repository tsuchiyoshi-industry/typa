import { beforeEach, describe, expect, it, vi } from "vitest";
import { EvaluationAllocation } from "../../domain/valueObjects/EvaluationAllocation";
import { commonRepository, commonResult, employeeRepository } from "../../test/fixtures";

const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("../db/supabase", () => ({ supabase: { from: db.from, rpc: db.rpc } }));

import { SupabaseEvaluationSheetRepository } from "./SupabaseEvaluationSheetRepository";

function setup(status = "first_evaluated") {
	const employee = {
		name: "社員",
		employee_no: "TEST001",
		career_course: "技術",
		grade_id: 1,
		primary_evaluator_id: 2,
		secondary_evaluator_id: 3,
	};
	const sheet = {
		id: 100,
		period_id: 10,
		employee_id: 1,
		status,
		total_score: 0,
		first_overall_comment: "一次",
		second_overall_comment: "二次",
		objectives_first_total_score: 8,
		objectives_first_total_rate: 100,
		objectives_second_total_score: 5,
		objectives_second_total_rate: 63,
		common_evaluation_first_total_score: 15,
		common_evaluation_first_total_rate: 75,
		common_evaluation_second_total_score: 20,
		common_evaluation_second_total_rate: 100,
		// 保存された集計が古くても、未確定のシートは現在の配点で換算する
		objectives_second_evaluation_score: 13,
		common_evaluation_second_evaluation_score: 80,
		total_evaluation_score: 93,
		objective_allocation: 20,
		common_allocation: 80,
		final_rank_letter: "A",
		final_rank_level: "none",
		primary_evaluator_id: 2,
		secondary_evaluator_id: 3,
		no_secondary_evaluator: false,
		period: { period_name: "テスト期間", start_date: "2026-04-01", end_date: "2026-09-30" },
		employee,
	};
	const objectives = [2, 3].map((score, i) => ({
		id: 11 + i,
		sheet_id: 100,
		goal_number: i + 1,
		challenge_goal: "目標",
		midterm_goal: "中間",
		achievement: "達成",
		first_score: 4,
		second_score: score,
	}));
	db.from.mockImplementation((table: string) => ({
		select: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		single: vi.fn().mockResolvedValue({ data: sheet, error: null }),
		maybeSingle: vi.fn().mockResolvedValue({
			data: {
				id: 10,
				period_name: "テスト期間",
				start_date: "2026-04-01",
				end_date: "2026-09-30",
				is_active: true,
			},
			error: null,
		}),
		order: vi
			.fn()
			.mockResolvedValue({ data: table === "milestones" ? objectives : null, error: null }),
	}));
	const settings = {
		findAllocation: vi.fn().mockResolvedValue(EvaluationAllocation.of(31, 69)),
		saveAllocation: vi.fn(),
		findMaxChallengeGoals: vi.fn().mockResolvedValue(4),
		saveMaxChallengeGoals: vi.fn(),
	};
	const common = commonRepository();
	common.findResultsBySheetId.mockResolvedValue({
		results: [commonResult()],
		totalFirstScore: 15,
		totalSecondScore: 20,
		totalWeight: 5,
		firstRate: 75,
		secondRate: 100,
	});
	const employees = employeeRepository();
	const repo = new SupabaseEvaluationSheetRepository(employees, common, settings);
	return { sheet, repo, settings, common, employees };
}

beforeEach(() => vi.clearAllMocks());

describe("the overview of every sheet", () => {
	const row = (overrides: object) => ({
		id: 100,
		periodId: 10,
		employeeId: 1,
		status: "submitted",
		createdAt: "created",
		updatedAt: "updated",
		periodName: "テスト期間",
		periodStart: "2026-04-01",
		periodEnd: "2026-09-30",
		employeeName: "社員",
		employeeNo: "TEST001",
		gradeName: "等級",
		primaryEvaluator: "一次",
		secondaryEvaluator: "二次",
		noSecondaryEvaluator: false,
		finalScore: null,
		finalRank: null,
		firstRank: null,
		firstOverallComment: "",
		secondOverallComment: "",
		...overrides,
	});
	it("names the evaluators, telling 'none by decision' from 'not assigned yet'", async () => {
		db.rpc.mockResolvedValue({
			data: [
				row({
					status: "finalized",
					finalScore: 88,
					finalRank: "B+",
					firstRank: "B",
					firstOverallComment: "一次の総評",
					secondOverallComment: "二次の総評",
				}),
				row({ secondaryEvaluator: null, noSecondaryEvaluator: true }),
				row({ primaryEvaluator: null, secondaryEvaluator: null }),
			],
			error: null,
		});
		const rows = await setup().repo.findOverview();
		expect(db.rpc).toHaveBeenCalledExactlyOnceWith("get_sheet_overview");
		expect(rows.map((item) => [item.primaryEvaluatorName, item.secondaryEvaluatorName])).toEqual([
			["一次", "二次"],
			["一次", "なし"],
			["未設定", "未設定"],
		]);
		expect(rows[0].status.isFinalized()).toBe(true);
		expect(rows[0]).toMatchObject({
			finalScore: 88,
			finalRank: "B+",
			firstRank: "B",
			firstOverallComment: "一次の総評",
			secondOverallComment: "二次の総評",
		});
		expect(rows[1]).toMatchObject({ finalScore: null, finalRank: null });
		expect(rows[0]).not.toHaveProperty("noSecondaryEvaluator");
	});
	it("does not treat a refused or failed read as an empty company", async () => {
		db.rpc.mockResolvedValue({ data: null, error: new Error("Only Admin") });
		await expect(setup().repo.findOverview()).rejects.toThrow("Only Admin");
	});
});

describe("restoring a sheet from stored rows", () => {
	it("does not treat failed objective reads as an empty, complete set of evaluation items", async () => {
		const { repo } = setup();
		const makeQuery = db.from.getMockImplementation();
		if (!makeQuery) {
			throw new Error("mock is not initialized");
		}
		db.from.mockImplementation((table: string) => {
			const query = makeQuery(table);
			if (table === "milestones") {
				query.order.mockResolvedValue({ data: null, error: new Error("goal read failed") });
			}
			return query;
		});
		await expect(repo.findById(100)).rejects.toThrow("goal read failed");
	});
	it("uses the evaluators the sheet carries, not the employee's current ones", async () => {
		// 社員マスタでは評価者が 2・3 に付け替わっていても、シートは 7 が評価して二次評価者「なし」
		const { sheet: row, repo, employees } = setup("finalized");
		Object.assign(row, {
			primary_evaluator_id: 7,
			secondary_evaluator_id: null,
			no_secondary_evaluator: true,
		});
		const sheet = await repo.findById(100);
		expect(sheet?.subject).toMatchObject({ primaryEvaluatorId: 7, secondaryEvaluatorId: null });
		expect(sheet?.primaryIsFinalEvaluator()).toBe(true);
		expect(employees.findEvaluatorNames).toHaveBeenCalledWith(7, null, true);
	});
	it("uses current settings and the exact fraction in an open sheet and export", async () => {
		const { repo } = setup();
		const sheet = await repo.findById(100);
		expect(sheet?.allocatedScores).toMatchObject({
			objectiveAllocationScore: 31,
			objectiveEvaluationScore: 19,
			commonEvaluationAllocationScore: 69,
			commonEvaluationEvaluationScore: 69,
			totalEvaluationScore: 88,
		});
		// 31 × 8/8 + 69 × 15/20 = 31 + 52 = 83
		expect(sheet?.firstEvaluationScore()).toBe(83);
	});
	it("ignores stale stored totals in an open sheet and calculates from the actual scores", async () => {
		// 等級や項目が変わる前に保存された合計(28点・280%)が残っていても、いまの点数(配点 5 × 評価 3 = 15 / 20)で計算する
		const { sheet: row, repo } = setup("submitted");
		Object.assign(row, {
			objectives_first_total_score: 4,
			objectives_first_total_rate: 100,
			common_evaluation_first_total_score: 28,
			common_evaluation_first_total_rate: 280,
		});
		const sheet = await repo.findById(100);
		expect(sheet?.commonEvaluationScoreTotals).toMatchObject({
			firstTotalScore: 15,
			firstTotalRate: 75,
		});
		expect(sheet?.objectiveScoreTotals).toMatchObject({ firstTotalScore: 8, firstTotalRate: 100 });
		// 31 × 8/8 + 69 × 15/20 = 31 + 52 = 83 点。100 点を超えない
		expect(sheet?.firstEvaluationScore()).toBe(83);
	});
	it("preserves finalized scores, weights and ranks without reading current settings", async () => {
		const { repo, settings } = setup("finalized");
		const sheet = await repo.findById(100);
		expect(sheet?.allocatedScores).toMatchObject({
			objectiveAllocationScore: 20,
			commonEvaluationAllocationScore: 80,
			totalEvaluationScore: 93,
		});
		expect(sheet?.resolveFinalEvaluationRank().toDisplayText()).toBe("A");
		expect(settings.findAllocation).not.toHaveBeenCalled();
	});
	it("restores the grade held when the sheet was created, not the employee's current grade", async () => {
		const { sheet: row, repo, common } = setup();
		// 社員の今の等級は 5(fixtures)。シートは等級 1 のときに作った
		Object.assign(row, { grade_id: 1 });
		const sheet = await repo.findById(100);
		expect(sheet?.gradeId).toBe(1);
		expect(sheet?.subject.gradeId).toBe(5);
		expect(common.findResultsBySheetId).toHaveBeenCalledWith(100, 1);
	});
	it("keeps a sheet without a grade ungraded instead of using the current grade", async () => {
		const { sheet: row, repo, common } = setup();
		Object.assign(row, { grade_id: null });
		expect((await repo.findById(100))?.gradeId).toBeNull();
		expect(common.findResultsBySheetId).toHaveBeenCalledWith(100, null);
	});
	it("fails an active calculation if settings cannot be loaded instead of silently using 20/80", async () => {
		const { repo, settings } = setup();
		settings.findAllocation.mockRejectedValue(new Error("settings unavailable"));
		await expect(repo.findById(100)).rejects.toThrow("settings unavailable");
	});
});
