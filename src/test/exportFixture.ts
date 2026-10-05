import type { EvaluationSheetExportData } from "../domain/repositories/EvaluationSheetRepository";
export function exportData(): EvaluationSheetExportData {
	return {
		sheetId: 100,
		employeeName: "テスト社員",
		employeeNo: "TEST001",
		careerCourse: "技術",
		gradeName: "等級",
		periodName: "テスト期間",
		periodStart: "2026-04-01",
		periodEnd: "2026-09-30",
		primaryEvaluator: "一次",
		secondaryEvaluator: "二次",
		status: "submitted",
		totalScore: 0,
		finalEvaluationRank: "A＋",
		objectiveAllocationScore: 20,
		objectiveSecondRate: 100,
		objectiveEvaluationScore: 20,
		commonEvaluationAllocationScore: 80,
		commonEvaluationSecondRate: 100,
		commonEvaluationEvaluationScore: 80,
		totalEvaluationScore: 100,
		firstOverallComment: "一次総評",
		secondOverallComment: "二次総評",
		objectives: [
			{
				id: 11,
				goalNumber: 1,
				challengeGoal: "目標",
				midtermGoal: "中間",
				achievement: "達成",
				selfScore: 2,
				evaluatorScore: 4,
			},
		],
		commonEvaluations: [
			{
				itemName: "共通",
				itemDescription: "説明",
				weight: 5,
				selfScore: 3,
				evaluatorScore: 5,
				selfComment: "一次コメント",
				evaluatorComment: "二次コメント",
			},
		],
	};
}
