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
		role: "secondary",
		canViewSecond: true,
		canViewFinal: true,
		sheetId: 100 + id,
		status: "submitted",
		updatedAt: "2026-10-07T01:00:00Z",
		revision: `revision-${id}`,
		reviewedAt: null,
		reviewed: false,
		needsRecheck: false,
		primaryReviewed: false,
		firstOverallComment: "一次評価の根拠",
		secondOverallComment: "二次評価の根拠",
		finalRank: "A",
		finalScore: 80,
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
