import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("../db/supabase", () => ({ supabase: { from: db.from, rpc: db.rpc } }));

import { SupabaseEvaluationSheetRepository } from "./SupabaseEvaluationSheetRepository";

/** DB 関数 get_sheet が返す形。目標 2 件(一次 4・4、二次 2・3)と、配点 5 の共通評価(一次 3・二次 4)。 */
const sheetRow = (overrides: object = {}) => ({
	id: 100,
	status: "first_evaluated",
	gradeId: 1,
	gradeName: "等級",
	subject: { id: 1, name: "社員", employeeNo: "TEST001", roleId: 1, careerCourse: "技術" },
	primaryEvaluatorId: 2,
	secondaryEvaluatorId: 3,
	noSecondaryEvaluator: false,
	primaryEvaluatorName: "一次",
	secondaryEvaluatorName: "二次",
	period: {
		id: 10,
		termName: "テスト期間",
		division: "full",
		part: 1,
		startDate: "2026-04-01",
		endDate: "2026-09-30",
		isActive: true,
		allowUnfinalizedClose: false,
	},
	firstOverallComment: "一次総評",
	secondOverallComment: "二次総評",
	firstRank: "B+",
	finalRankLetter: null,
	finalRankLevel: null,
	stored: {},
	objectives: [2, 3].map((secondScore, index) => ({
		id: 11 + index,
		goalNumber: index + 1,
		challengeGoal: "目標",
		midtermGoal: "中間",
		achievement: "達成",
		firstScore: 4,
		secondScore,
	})),
	commonResults: [
		{
			id: 21,
			itemId: 31,
			title: "共通項目",
			description: "説明",
			weight: 5,
			itemSetId: 5,
			firstScore: 3,
			secondScore: 4,
			firstComment: "所見",
		},
	],
	allocation: { objective: 31, common: 69 },
	maxChallengeGoals: 4,
	...overrides,
});
const stored = {
	objectivesFirstTotalScore: 8,
	objectivesFirstTotalRate: 100,
	objectivesSecondTotalScore: 5,
	objectivesSecondTotalRate: 63,
	commonEvaluationFirstTotalScore: 15,
	commonEvaluationFirstTotalRate: 75,
	commonEvaluationSecondTotalScore: 20,
	commonEvaluationSecondTotalRate: 100,
	objectivesSecondEvaluationScore: 13,
	commonEvaluationSecondEvaluationScore: 80,
	totalEvaluationScore: 93,
	objectiveAllocation: 20,
	commonAllocation: 80,
};
const find = (overrides: object = {}) => {
	db.rpc.mockResolvedValue({ data: sheetRow(overrides), error: null });
	return new SupabaseEvaluationSheetRepository().findById(100);
};

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
		const rows = await new SupabaseEvaluationSheetRepository().findOverview();
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
		await expect(new SupabaseEvaluationSheetRepository().findOverview()).rejects.toThrow(
			"Only Admin",
		);
	});
});

describe("reading a sheet", () => {
	it("reads the whole sheet in one request", async () => {
		const sheet = await find();
		expect(db.rpc).toHaveBeenCalledExactlyOnceWith("get_sheet", { p_sheet_id: 100 });
		expect(db.from).not.toHaveBeenCalled();
		expect(sheet).toMatchObject({
			sheetId: 100,
			primaryEvaluatorName: "一次",
			secondaryEvaluatorName: "二次",
			firstOverallComment: "一次総評",
			maxObjectives: 4,
		});
		expect(sheet?.evaluationPeriod).toMatchObject({ id: 10, isActive: true });
		expect(sheet?.objectives.map((goal) => [goal.id, goal.sheetId, goal.goalNumber])).toEqual([
			[11, 100, 1],
			[12, 100, 2],
		]);
		expect(sheet?.commonEvaluationResults[0]).toMatchObject({ id: 21, sheetId: 100, itemId: 31 });
		expect(sheet?.commonEvaluationResults[0].item).toMatchObject({ title: "共通項目", weight: 5 });
		expect(sheet?.resolveFirstEvaluationRank().toDisplayText()).toBe("B+");
	});
	it("does not treat a failed read as a missing sheet", async () => {
		db.rpc.mockResolvedValue({ data: null, error: new Error("read failed") });
		await expect(new SupabaseEvaluationSheetRepository().findById(100)).rejects.toThrow(
			"read failed",
		);
	});
	it("returns null for a sheet the caller is not on", async () => {
		db.rpc.mockResolvedValue({ data: null, error: null });
		await expect(new SupabaseEvaluationSheetRepository().findById(100)).resolves.toBeNull();
	});
	it("uses the evaluators the sheet carries, telling 'none by decision' from 'not assigned yet'", async () => {
		const withoutSecondary = {
			primaryEvaluatorId: 7,
			secondaryEvaluatorId: null,
			secondaryEvaluatorName: null,
		};
		const none = await find({ ...withoutSecondary, noSecondaryEvaluator: true });
		expect(none?.subject).toMatchObject({ primaryEvaluatorId: 7, secondaryEvaluatorId: null });
		expect(none?.primaryIsFinalEvaluator()).toBe(true);
		expect(none?.secondaryEvaluatorName).toBe("なし");
		const unassigned = await find({ ...withoutSecondary, primaryEvaluatorName: null });
		expect(unassigned?.primaryIsFinalEvaluator()).toBe(false);
		expect([unassigned?.primaryEvaluatorName, unassigned?.secondaryEvaluatorName]).toEqual([
			"未設定",
			"未設定",
		]);
	});
	it("uses current settings and the exact fraction in an open sheet and export", async () => {
		const sheet = await find();
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
		const sheet = await find({
			status: "submitted",
			stored: {
				...stored,
				objectivesFirstTotalScore: 4,
				commonEvaluationFirstTotalScore: 28,
				commonEvaluationFirstTotalRate: 280,
			},
		});
		expect(sheet?.commonEvaluationScoreTotals).toMatchObject({
			firstTotalScore: 15,
			firstTotalRate: 75,
		});
		expect(sheet?.objectiveScoreTotals).toMatchObject({ firstTotalScore: 8, firstTotalRate: 100 });
		// 31 × 8/8 + 69 × 15/20 = 31 + 52 = 83 点。100 点を超えない
		expect(sheet?.firstEvaluationScore()).toBe(83);
	});
	it("preserves finalized scores, weights and ranks whatever the current settings are", async () => {
		const sheet = await find({
			status: "finalized",
			stored,
			finalRankLetter: "A",
			finalRankLevel: "none",
		});
		expect(sheet?.allocatedScores).toMatchObject({
			objectiveAllocationScore: 20,
			commonEvaluationAllocationScore: 80,
			totalEvaluationScore: 93,
		});
		expect(sheet?.resolveFinalEvaluationRank().toDisplayText()).toBe("A");
	});
	it("restores the grade held when the sheet was created, also when it had none", async () => {
		expect((await find({ gradeId: 1 }))?.gradeId).toBe(1);
		expect((await find({ gradeId: null }))?.gradeId).toBeNull();
	});
	it("gives an item without a saved result a placeholder id", async () => {
		const sheet = await find({
			commonResults: [{ ...sheetRow().commonResults[0], id: null, firstScore: 0, secondScore: 0 }],
		});
		expect(sheet?.commonEvaluationResults[0]).toMatchObject({ id: -31, itemId: 31 });
		expect(sheet?.pendingEvaluationItems("first")).toContain("共通評価「共通項目」");
	});
	it("fails if the settings are missing instead of silently using 20/80 or 4 goals", async () => {
		await expect(find({ allocation: null })).rejects.toThrow("配点設定");
		await expect(find({ maxChallengeGoals: null })).rejects.toThrow("上限");
	});
});
