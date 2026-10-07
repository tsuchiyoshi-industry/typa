import type { ReviewerRowDto } from "../application/dtos/ReviewerWorkspaceDto";

export function reviewerRow(id = 1, overrides: Partial<ReviewerRowDto> = {}): ReviewerRowDto {
	return {
		employeeId: id,
		employeeName: `社員${id}`,
		employeeNo: `E00${id}`,
		gradeId: 1,
		gradeName: "技術1級",
		careerCourse: "技術",
		primaryEvaluator: "一次 太郎",
		primaryEvaluatorId: 2,
		// 既定は「一次評価が確定し、二次評価者である自分の番」
		isPrimary: false,
		canViewSecond: true,
		canViewFinal: true,
		primaryIsFinal: false,
		sheetId: 100 + id,
		status: "first_evaluated",
		updatedAt: "2026-10-07T01:00:00Z",
		objectiveAllocation: 20,
		commonAllocation: 80,
		firstOverallComment: "一次評価の根拠",
		secondOverallComment: "二次評価の根拠",
		firstRank: "B-",
		finalRank: null,
		finalScore: null,
		objectives: [
			{
				id: 10 + id,
				goalNumber: 1,
				challengeGoal: "業務の品質を高める",
				achievement: "改善を実施",
				firstScore: 2,
				secondScore: 3,
			},
		],
		commonItems: [
			{
				id: 21,
				title: "業務遂行",
				weight: 5,
				firstScore: 3,
				secondScore: 4,
				firstComment: "計画に沿って達成",
			},
		],
		...overrides,
	};
}
