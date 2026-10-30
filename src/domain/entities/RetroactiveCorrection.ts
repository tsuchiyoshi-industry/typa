import { err, ok, type Result } from "../Result";
import { CorrectionField, parsePeriodGoals } from "../valueObjects/CorrectionField";
import { CorrectionReason } from "../valueObjects/CorrectionReason";
import type { CorrectionError } from "./CorrectionError";
import type { EvaluationSheet } from "./EvaluationSheet";
import { describeCorrected } from "./SheetCorrection";

/** 画面から来る、直したい内容の1つ。 */
export interface RequestedChange {
	target: string;
	/** 目標なら milestones の id、共通評価なら項目の id。シート全体の項目は null。 */
	targetId: number | null;
	field: string;
	value: string;
}

/** 直す内容の1つ。今の値(修正前)を、シートから読んで持つ。 */
class PlannedCorrection {
	constructor(
		readonly field: CorrectionField,
		readonly targetId: number | null,
		readonly goalNumber: number | null,
		readonly itemTitle: string | null,
		readonly before: string,
		readonly after: string,
	) {}

	get subject(): string {
		return describeCorrected(this.field, this.goalNumber, this.itemTitle);
	}

	get beforeText(): string {
		return this.field.display(this.before);
	}

	get afterText(): string {
		return this.field.display(this.after);
	}
}

/**
 * 遡及処理(締め後修正)。締めた評価期間を開き直さずに、締めたシートの項目を直す。
 * 直すのは締め済みの評価期間のシートだけで、理由を必ず残す。同じ項目を一度に2回直したり、
 * 今と同じ値に「直したり」はしない。二次評価者を置かないシートには、二次評価点はない。
 */
export class RetroactiveCorrection {
	private constructor(
		readonly sheetId: number,
		readonly reason: CorrectionReason,
		readonly changes: readonly PlannedCorrection[],
	) {}

	static propose(
		sheet: EvaluationSheet,
		requested: readonly RequestedChange[],
		reason: string,
	): Result<RetroactiveCorrection, CorrectionError> {
		if (!sheet.evaluationPeriod.allowsRetroactiveCorrection()) {
			return err({ kind: "periodNotClosed" });
		}
		const why = CorrectionReason.from(reason);
		if (!why.ok) {
			return why;
		}
		if (requested.length === 0) {
			return err({ kind: "noChanges" });
		}
		const changes: PlannedCorrection[] = [];
		for (const change of requested) {
			const planned = planChange(sheet, change);
			if (!planned.ok) {
				return planned;
			}
			changes.push(planned.value);
		}
		const keys = changes.map(
			(change) => `${change.field.target}:${change.targetId}:${change.field.value}`,
		);
		if (new Set(keys).size !== keys.length) {
			return err({ kind: "duplicate" });
		}
		const goals = correctedGoalsValid(sheet, changes);
		return goals.ok ? ok(new RetroactiveCorrection(sheet.sheetId, why.value, changes)) : goals;
	}
}

/** 直したい内容の1つを確かめ、今の値(修正前)と組にする。 */
function planChange(
	sheet: EvaluationSheet,
	change: RequestedChange,
): Result<PlannedCorrection, CorrectionError> {
	const field = CorrectionField.of(change.target, change.field);
	if (!field.ok) {
		return field;
	}
	const valid = field.value.validate(change.value);
	if (!valid.ok) {
		return valid;
	}
	if (field.value.value === "second_score" && sheet.primaryIsFinalEvaluator()) {
		return err({ kind: "noSecondScore" });
	}
	const planned = plan(sheet, field.value, change.targetId, change.value);
	if (planned.ok && planned.value.before === planned.value.after) {
		return err({ kind: "sameValue", subject: planned.value.subject });
	}
	return planned;
}

/** シートから今の値を読んで、直す内容にする。シートに無い目標・項目は直せない。 */
function plan(
	sheet: EvaluationSheet,
	field: CorrectionField,
	targetId: number | null,
	after: string,
): Result<PlannedCorrection, CorrectionError> {
	switch (field.target) {
		case "goal": {
			const goal = sheet.objectives.find((objective) => objective.id === targetId);
			if (!goal) {
				return err({ kind: "notThisSheetGoal" });
			}
			const before = {
				challenge_goal: goal.challengeGoal,
				period_goals: JSON.stringify(goal.periodGoals),
				achievement: goal.achievement,
				first_score: String(goal.firstScore.toNumber()),
				second_score: String(goal.secondScore.toNumber()),
			}[field.value as "challenge_goal"];
			return ok(new PlannedCorrection(field, targetId, goal.goalNumber, null, before, after));
		}
		case "common": {
			const result = sheet.commonEvaluationResults.find((item) => item.item.id === targetId);
			if (!result) {
				return err({ kind: "notThisSheetItem" });
			}
			const before = {
				first_score: String(result.firstScore.toNumber()),
				second_score: String(result.secondScore.toNumber()),
				first_comment: result.firstComment.toString(),
			}[field.value as "first_score"];
			return ok(new PlannedCorrection(field, targetId, null, result.item.title, before, after));
		}
		default: {
			const before =
				field.value === "first_overall_comment"
					? sheet.firstOverallComment
					: sheet.secondOverallComment;
			return ok(new PlannedCorrection(field, null, null, null, before, after));
		}
	}
}

/** 直した後の目標も、目標として正しいか(期中目標があるなら、チャレンジ目標の達成状況は空)。 */
function correctedGoalsValid(
	sheet: EvaluationSheet,
	changes: readonly PlannedCorrection[],
): Result<void, CorrectionError> {
	for (const goal of sheet.objectives) {
		const mine = changes.filter(
			(change) => change.field.target === "goal" && change.targetId === goal.id,
		);
		const after = (field: string) => mine.find((change) => change.field.value === field)?.after;
		const periodGoals = after("period_goals");
		const achievement = after("achievement");
		if (periodGoals === undefined && achievement === undefined) {
			continue;
		}
		const next = goal.withCorrectedText({
			// 形は validate で確かめてある
			periodGoals: periodGoals === undefined ? undefined : (parsePeriodGoals(periodGoals) ?? []),
			achievement,
		});
		if (!next.ok) {
			return err({ kind: "goalInvalid", goalNumber: goal.goalNumber, error: next.error });
		}
	}
	return ok(undefined);
}
