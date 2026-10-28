import { EvaluationAllocatedScores } from "../valueObjects/EvaluationAllocatedScores";
import { EvaluationAllocation } from "../valueObjects/EvaluationAllocation";
import { EvaluationRank } from "../valueObjects/EvaluationRank";
import { EvaluationScoreTotals } from "../valueObjects/EvaluationScoreTotals";
import { EvaluationStatus, type EvaluationStatusValue } from "../valueObjects/EvaluationStatus";
import type { PeriodGoal } from "../valueObjects/PeriodGoal";

export interface ReviewObjective {
	id: number;
	goalNumber: number;
	challengeGoal: string;
	periodGoals: readonly PeriodGoal[];
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

/** いま誰の番か。first / second は自分が評価して確定する番、waiting は本人か相手の評価者の番。 */
export type ReviewTask = "goals" | "first" | "second" | "waiting" | "finalized";

/** シートの状態。この期間のシートがまだ無ければ undefined。 */
export const sheetStatus = (row: ReviewerRow): EvaluationStatus | undefined =>
	EvaluationStatus.find(row.status);

/** 自分の番は、いまの状態のボール(EvaluationStatus.holder)を自分の役割が持っているとき。 */
export function reviewTask(row: ReviewerRow): ReviewTask {
	const status = sheetStatus(row);
	if (status?.isFinalized()) {
		return "finalized";
	}
	const holder = status?.holder();
	if (holder === "primary" && row.isPrimary) {
		return status?.isGoalsSubmitted() ? "goals" : "first";
	}
	// 二次評価者「なし」の社員の一次評価済み(以前のデータ)は、最終評価者を兼ねる一次評価者の番
	if (holder === "secondary" && row.canViewFinal) {
		return "second";
	}
	return "waiting";
}

export const isMyTurn = (row: ReviewerRow): boolean =>
	reviewTask(row) === "goals" || reviewTask(row) === "first" || reviewTask(row) === "second";

/** 評価者は、本人が目標を送信したシートだけを開ける。下書きは内容が届かない。 */
export const canOpen = (row: ReviewerRow): boolean =>
	row.sheetId !== null && !!sheetStatus(row)?.isSentToEvaluators();

/**
 * 進み具合。段階は「目標送信 → 目標確定 → 一次評価依頼 → 一次評価 → 二次評価」。二次評価者なしの社員は4段階。
 * done は済んだ段階の数。
 */
export function reviewProgress(row: ReviewerRow): { steps: number; done: number } {
	const steps = row.primaryIsFinal ? 4 : 5;
	// 状態の進行順の位置が、そのまま済んだ段階の数になる(下書き 0 … 二次評価待ち 4、確定で全段階)
	return { steps, done: Math.min(sheetStatus(row)?.order() ?? 0, steps) };
}

/** 最終評価(二次評価。「なし」の社員は一次評価)が始まっているか。始まる前の点数は意味を持たない。 */
const finalEvaluationStarted = (row: ReviewerRow): boolean => {
	const status = sheetStatus(row);
	return (
		!!status?.isFirstEvaluationConfirmed() ||
		(row.primaryIsFinal && !!status?.isAwaitingFirstEvaluation())
	);
};

/**
 * 一覧の行の評価点。シートと同じ値オブジェクトで計算するので、丸めも含めてシートの評価点と一致する。
 * 0 は未評価の点数で、完了の印ではない。
 */
export function reviewScore(row: ReviewerRow, stage: "first" | "second"): number | null {
	if (
		!canOpen(row) ||
		!sheetStatus(row)?.isEvaluationStarted() ||
		(stage === "second" && !(row.canViewSecond && finalEvaluationStarted(row)))
	) {
		return null;
	}
	const totals = (
		items: readonly { weight: number; firstScore: number; secondScore: number | null }[],
	) =>
		EvaluationScoreTotals.fromWeightedScores(
			items.map((item) => ({ ...item, secondScore: item.secondScore ?? 0 })),
		);
	return EvaluationAllocatedScores.fromTotals(
		totals(row.objectives.map((goal) => ({ ...goal, weight: 1 }))),
		totals(row.commonItems),
		stage === "first",
		EvaluationAllocation.of(row.objectiveAllocation, row.commonAllocation),
	).totalEvaluationScore;
}

export function finalScore(row: ReviewerRow): number | null {
	if (!row.canViewFinal || !canOpen(row) || !finalEvaluationStarted(row)) {
		return null;
	}
	return sheetStatus(row)?.isFinalized() && row.finalScore !== null
		? row.finalScore
		: reviewScore(row, row.canViewSecond ? "second" : "first");
}

/** 段階ごとの評価ランク。確定済みは保存値、評価中は現在の点数から決まる見込み。 */
export function reviewRank(
	row: ReviewerRow,
	stage: "first" | "final",
): { text: string; confirmed: boolean } | null {
	if (!canOpen(row)) {
		return null;
	}
	const stored = stage === "first" ? row.firstRank : row.finalRank;
	if (stored) {
		return { text: stored, confirmed: true };
	}
	const score = stage === "first" ? reviewScore(row, "first") : finalScore(row);
	return score === null
		? null
		: {
				text: EvaluationRank.fromScore(score, EvaluationAllocation.TOTAL).toDisplayText(),
				confirmed: false,
			};
}
