export interface ReviewObjective {
	id: number;
	goalNumber: number;
	challengeGoal: string;
	achievement: string;
	firstScore: number;
	secondScore: number | null;
}

export interface ReviewCommonItem {
	id: number;
	title: string;
	weight: number;
	firstScore: number;
	secondScore: number | null;
	firstComment: string;
}

/** A server-authorized projection. Hidden evaluation values are always null. */
export interface ReviewerRow {
	employeeId: number;
	employeeName: string;
	employeeNo: string;
	gradeId: number | null;
	gradeName: string;
	careerCourse: string;
	primaryEvaluator: string;
	primaryEvaluatorId: number | null;
	role: "primary" | "secondary";
	canViewSecond: boolean;
	canViewFinal: boolean;
	sheetId: number | null;
	status: "missing" | "draft" | "submitted" | "finalized";
	updatedAt: string | null;
	revision: string | null;
	reviewedAt: string | null;
	reviewed: boolean;
	needsRecheck: boolean;
	primaryReviewed: boolean;
	firstOverallComment: string;
	secondOverallComment: string | null;
	finalRank: string | null;
	finalScore: number | null;
	objectives: ReviewObjective[];
	commonItems: ReviewCommonItem[];
}
