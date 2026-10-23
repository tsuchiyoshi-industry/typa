import { DomainError } from "../DomainError";
import { CorrectionField } from "../valueObjects/CorrectionField";
import { CorrectionReason } from "../valueObjects/CorrectionReason";
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
export class PlannedCorrection {
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
	): RetroactiveCorrection {
		sheet.evaluationPeriod.assertAllowsRetroactiveCorrection();
		const why = CorrectionReason.from(reason);
		if (requested.length === 0) {
			throw new DomainError("修正する項目がありません。");
		}
		const changes = requested.map((change) => {
			const field = CorrectionField.of(change.target, change.field);
			field.assertValid(change.value);
			if (field.value === "second_score" && sheet.primaryIsFinalEvaluator()) {
				throw new DomainError("二次評価者を置かないシートには、二次評価点はありません。");
			}
			const planned = plan(sheet, field, change.targetId, change.value);
			if (planned.before === planned.after) {
				throw new DomainError(`「${planned.subject}」は、今と同じ内容には修正できません。`);
			}
			return planned;
		});
		const keys = changes.map(
			(change) => `${change.field.target}:${change.targetId}:${change.field.value}`,
		);
		if (new Set(keys).size !== keys.length) {
			throw new DomainError("同じ項目を一度に2回直すことはできません。");
		}
		return new RetroactiveCorrection(sheet.sheetId, why, changes);
	}
}

/** シートから今の値を読んで、直す内容にする。シートに無い目標・項目は例外。 */
function plan(
	sheet: EvaluationSheet,
	field: CorrectionField,
	targetId: number | null,
	after: string,
): PlannedCorrection {
	switch (field.target) {
		case "goal": {
			const goal = sheet.objectives.find((objective) => objective.id === targetId);
			if (!goal) {
				throw new DomainError("このシートの目標ではありません。");
			}
			const before = {
				challenge_goal: goal.challengeGoal,
				midterm_goal: goal.midtermGoal,
				achievement: goal.achievement,
				first_score: String(goal.firstScore.toNumber()),
				second_score: String(goal.secondScore.toNumber()),
			}[field.value as "challenge_goal"];
			return new PlannedCorrection(field, targetId, goal.goalNumber, null, before, after);
		}
		case "common": {
			const result = sheet.commonEvaluationResults.find((item) => item.item.id === targetId);
			if (!result) {
				throw new DomainError("このシートの共通評価の項目ではありません。");
			}
			const before = {
				first_score: String(result.firstScore.toNumber()),
				second_score: String(result.secondScore.toNumber()),
				first_comment: result.firstComment.toString(),
			}[field.value as "first_score"];
			return new PlannedCorrection(field, targetId, null, result.item.title, before, after);
		}
		default: {
			const before =
				field.value === "first_overall_comment"
					? sheet.firstOverallComment
					: sheet.secondOverallComment;
			return new PlannedCorrection(field, null, null, null, before, after);
		}
	}
}
