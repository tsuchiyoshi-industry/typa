import type { CorrectionError } from "../entities/CorrectionError";
import { err, ok, type Result } from "../Result";
import { type PeriodGoal, toPeriodGoals } from "./PeriodGoal";

/** 何を直すか。目標(goal)・共通評価の項目(common)・シート全体(sheet)。 */
export type CorrectionTarget = "goal" | "common" | "sheet";
export const CORRECTION_FIELD_VALUES = [
	"challenge_goal",
	"period_goals",
	"achievement",
	"first_score",
	"second_score",
	"first_comment",
	"first_overall_comment",
	"second_overall_comment",
] as const;
export type CorrectionFieldValue = (typeof CORRECTION_FIELD_VALUES)[number];
/**
 * その項目を見られる段階。content は記入した内容(本人と、送信後の評価者)、first は一次評価、
 * second は二次評価。修正も、直した項目と同じ人にだけ見せる。
 */
export type CorrectionStage = "content" | "first" | "second";

const FIELDS: Record<
	CorrectionTarget,
	Partial<Record<CorrectionFieldValue, { label: string; stage: CorrectionStage }>>
> = {
	goal: {
		challenge_goal: { label: "チャレンジ目標", stage: "content" },
		period_goals: { label: "期中目標と達成状況", stage: "content" },
		achievement: { label: "達成状況", stage: "content" },
		first_score: { label: "一次評価", stage: "first" },
		second_score: { label: "二次評価", stage: "second" },
	},
	common: {
		first_score: { label: "一次評価", stage: "first" },
		second_score: { label: "二次評価", stage: "second" },
		first_comment: { label: "一次評価者コメント", stage: "first" },
	},
	sheet: {
		first_overall_comment: { label: "一次評価者の総評", stage: "first" },
		second_overall_comment: { label: "二次評価者の総評", stage: "second" },
	},
};

/**
 * 引く表。Map にするのは、「constructor」などの Object の性質を、項目と取り違えないため
 * (ふつうのオブジェクトをキーで引くと、プロトタイプのものまで見つかる)。
 */
const LOOKUP = new Map(
	Object.entries(FIELDS).map(([target, fields]) => [target, new Map(Object.entries(fields))]),
);

/** 遡及処理で直せる項目。直せるものだけを、ここに挙げる(状態・評価者・ランクは直さない)。 */
export class CorrectionField {
	static readonly MAX_TEXT_LENGTH = 2000;

	private constructor(
		readonly target: CorrectionTarget,
		readonly value: CorrectionFieldValue,
		readonly label: string,
		readonly stage: CorrectionStage,
	) {}

	static of(target: string, field: string): Result<CorrectionField, CorrectionError> {
		const found = LOOKUP.get(target)?.get(field);
		return found
			? ok(
					new CorrectionField(
						target as CorrectionTarget,
						field as CorrectionFieldValue,
						found.label,
						found.stage,
					),
				)
			: err({ kind: "fieldNotCorrectable" });
	}

	get isScore(): boolean {
		return this.value === "first_score" || this.value === "second_score";
	}

	/**
	 * 直した後の値として正しいか。点数は 1〜4(未評価には戻さない)、文章は 2000 文字まで。
	 * 期中目標は JSON の一覧で、タスクごとの文章も 2000 文字まで。
	 */
	validate(value: string): Result<string, CorrectionError> {
		const tooLong = (text: string) => text.length > CorrectionField.MAX_TEXT_LENGTH;
		const textTooLong = err({ kind: "textTooLong", max: CorrectionField.MAX_TEXT_LENGTH } as const);
		if (this.value === "period_goals") {
			const goals = parsePeriodGoals(value);
			if (!goals) {
				return err({ kind: "periodGoalsMalformed" });
			}
			return goals.some((goal) => tooLong(goal.description) || tooLong(goal.achievement))
				? textTooLong
				: ok(value);
		}
		if (this.isScore) {
			return /^[1-4]$/.test(value) ? ok(value) : err({ kind: "scoreInvalid" });
		}
		return tooLong(value) ? textTooLong : ok(value);
	}

	/** 画面に出す値。点数の 0 は「未評価」、空の文章は「(空欄)」。 */
	display(value: string): string {
		if (this.value === "period_goals") {
			// 記録が壊れていても、履歴は読めるようにそのまま出す
			const goals = parsePeriodGoals(value);
			if (!goals) {
				return value;
			}
			return goals.length === 0
				? "(期中目標なし)"
				: goals
						.map(
							(goal, i) =>
								`${i + 1}. ${goal.description || "(空欄)"}（達成状況: ${goal.achievement || "(空欄)"}）`,
						)
						.join("\n");
		}
		if (this.isScore) {
			return value === "0" || value === "" ? "未評価" : value;
		}
		return value === "" ? "(空欄)" : value;
	}

	equals(other: CorrectionField): boolean {
		return this.target === other.target && this.value === other.value;
	}
}

/** JSON の期中目標の一覧。形が違えば null。 */
export function parsePeriodGoals(value: string): readonly PeriodGoal[] | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return null;
	}
	const goals = toPeriodGoals(parsed);
	return goals.ok ? goals.value : null;
}
