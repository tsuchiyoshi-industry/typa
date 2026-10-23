import { DomainError } from "../DomainError";

/** 何を直すか。目標(goal)・共通評価の項目(common)・シート全体(sheet)。 */
export type CorrectionTarget = "goal" | "common" | "sheet";
export const CORRECTION_FIELD_VALUES = [
	"challenge_goal",
	"midterm_goal",
	"achievement",
	"first_score",
	"second_score",
	"first_comment",
	"first_overall_comment",
	"second_overall_comment",
] as const;
export type CorrectionFieldValue = (typeof CORRECTION_FIELD_VALUES)[number];
/**
 * その項目を見られる段階。content は記入した内容(本人と、提出後の評価者)、first は一次評価、
 * second は二次評価。修正も、直した項目と同じ人にだけ見せる。
 */
export type CorrectionStage = "content" | "first" | "second";

const FIELDS: Record<
	CorrectionTarget,
	Partial<Record<CorrectionFieldValue, { label: string; stage: CorrectionStage }>>
> = {
	goal: {
		challenge_goal: { label: "チャレンジ目標", stage: "content" },
		midterm_goal: { label: "中間目標", stage: "content" },
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

/** 遡及処理で直せる項目。直せるものだけを、ここに挙げる(状態・評価者・ランクは直さない)。 */
export class CorrectionField {
	static readonly MAX_TEXT_LENGTH = 2000;

	private constructor(
		readonly target: CorrectionTarget,
		readonly value: CorrectionFieldValue,
		readonly label: string,
		readonly stage: CorrectionStage,
	) {}

	static of(target: string, field: string): CorrectionField {
		const found = (
			FIELDS as Record<string, Record<string, { label: string; stage: CorrectionStage }>>
		)[target]?.[field];
		if (!found) {
			throw new DomainError("遡及処理で直せない項目です。");
		}
		return new CorrectionField(
			target as CorrectionTarget,
			field as CorrectionFieldValue,
			found.label,
			found.stage,
		);
	}

	get isScore(): boolean {
		return this.value === "first_score" || this.value === "second_score";
	}

	/** 直した後の値として正しいか。点数は 1〜4(未評価には戻さない)、文章は 2000 文字まで。 */
	assertValid(value: string): void {
		if (this.isScore) {
			if (!/^[1-4]$/.test(value)) {
				throw new DomainError("点数は 1〜4 で入力してください。");
			}
		} else if (value.length > CorrectionField.MAX_TEXT_LENGTH) {
			throw new DomainError(
				`文章は ${CorrectionField.MAX_TEXT_LENGTH} 文字以内で入力してください。`,
			);
		}
	}

	/** 画面に出す値。点数の 0 は「未評価」、空の文章は「(空欄)」。 */
	display(value: string): string {
		if (this.isScore) {
			return value === "0" || value === "" ? "未評価" : value;
		}
		return value === "" ? "(空欄)" : value;
	}

	equals(other: CorrectionField): boolean {
		return this.target === other.target && this.value === other.value;
	}
}
