import { expectOk } from "../Result";
import { CorrectionField, type CorrectionStage } from "../valueObjects/CorrectionField";
import { describeCorrectionError } from "./CorrectionError";

/**
 * 締め後修正(遡及処理)の記録。評価期間を締めた後に、Admin がシートの項目を直したこと。
 * 消えない記録で、本人・評価者がシートを振り返ったときに「締め後修正」として見える。
 */
export class SheetCorrection {
	private constructor(
		readonly id: number,
		readonly field: CorrectionField,
		/** 目標の修正なら、直した時点の目標番号。 */
		readonly goalNumber: number | null,
		/** 共通評価の修正なら、直した時点の項目名。 */
		readonly itemTitle: string | null,
		readonly before: string,
		readonly after: string,
		readonly reason: string,
		/** ISO 8601。 */
		readonly correctedAt: string,
	) {}

	static restore(params: {
		id: number;
		target: string;
		field: string;
		goalNumber?: number | null;
		itemTitle?: string | null;
		before: string;
		after: string;
		reason: string;
		correctedAt: string;
	}): SheetCorrection {
		return new SheetCorrection(
			params.id,
			expectOk(CorrectionField.of(params.target, params.field), describeCorrectionError),
			params.goalNumber ?? null,
			params.itemTitle ?? null,
			params.before,
			params.after,
			params.reason,
			params.correctedAt,
		);
	}

	get stage(): CorrectionStage {
		return this.field.stage;
	}

	/** 「チャレンジ目標 2・二次評価」「共通評価「専門性」・一次評価」「二次評価者の総評」。 */
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

/** 直した項目の呼び方。記録済みの修正にも、これから直す内容にも使う。 */
export function describeCorrected(
	field: CorrectionField,
	goalNumber: number | null,
	itemTitle: string | null,
): string {
	switch (field.target) {
		case "goal":
			return `チャレンジ目標 ${goalNumber ?? ""}・${field.label}`;
		case "common":
			return `共通評価「${itemTitle ?? ""}」・${field.label}`;
		default:
			return field.label;
	}
}
