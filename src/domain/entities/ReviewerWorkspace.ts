import type { EvaluationStatusValue } from "../valueObjects/EvaluationStatus";

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

/**
 * A server-authorized projection. Hidden evaluation values are always null,
 * and a draft carries no content: evaluators see a sheet only once it is submitted.
 */
export interface ReviewerRow {
	employeeId: number;
	employeeName: string;
	employeeNo: string;
	gradeId: number | null;
	gradeName: string;
	careerCourse: string;
	primaryEvaluator: string;
	primaryEvaluatorId: number | null;
	/** 自分がこの社員の一次評価者か。 */
	isPrimary: boolean;
	/** 自分がこの社員の二次評価者か(二次評価の内容を見られる)。 */
	canViewSecond: boolean;
	canViewFinal: boolean;
	/** 二次評価者「なし」の社員。一次評価の確定がそのまま評価の確定になる。 */
	primaryIsFinal: boolean;
	sheetId: number | null;
	/** シートの状態。missing は、この期間のシートがまだ作られていない。 */
	status: EvaluationStatusValue | "missing";
	updatedAt: string | null;
	/** 評価点の配点。確定済みのシートは確定時の配点、それ以外は現在の設定。 */
	objectiveAllocation: number;
	commonAllocation: number;
	firstOverallComment: string;
	secondOverallComment: string | null;
	/** 確定済みのランク。未確定の段階は null で、現在の点数から見込みを出す。 */
	firstRank: string | null;
	finalRank: string | null;
	finalScore: number | null;
	objectives: ReviewObjective[];
	commonItems: ReviewCommonItem[];
}
