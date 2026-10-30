import type { PeriodError } from "../entities/PeriodError";
import { err, ok, type Result } from "../Result";

/** DB にはこの文字列で保存する。 */
const PERIOD_DIVISION_VALUES = ["full", "half", "quarter"] as const;
export type PeriodDivisionValue = (typeof PERIOD_DIVISION_VALUES)[number];

/**
 * 期(年度)を、いくつの評価期間に分けて評価するか。分けた評価期間はそれぞれ独立していて、
 * それぞれで評価が完結する(上期と下期の点数を期として平均したりはしない)。
 */
export class PeriodDivision {
	private constructor(
		private readonly value: PeriodDivisionValue,
		/** 画面で選ぶときの呼び方。 */
		readonly label: string,
		/** 評価期間の名前に付ける、区切りの呼び方(通年は付けない)。 */
		private readonly partLabels: readonly string[],
	) {}

	static readonly FULL = new PeriodDivision("full", "通年", [""]);
	static readonly HALF = new PeriodDivision("half", "半期(上期・下期)", ["上期", "下期"]);
	static readonly QUARTER = new PeriodDivision("quarter", "四半期", [
		"第1四半期",
		"第2四半期",
		"第3四半期",
		"第4四半期",
	]);
	static readonly ALL: readonly PeriodDivision[] = [
		PeriodDivision.FULL,
		PeriodDivision.HALF,
		PeriodDivision.QUARTER,
	];

	/** 知らない値は失敗(勝手に通年として扱わない)。 */
	static from(value: string): Result<PeriodDivision, PeriodError> {
		const division = PeriodDivision.ALL.find((candidate) => candidate.value === value);
		return division ? ok(division) : err({ kind: "divisionUnknown" });
	}

	/** 1つの期を、いくつの評価期間に分けるか。 */
	get parts(): number {
		return this.partLabels.length;
	}

	/** 1つの評価期間の長さ(月)。年度を12か月として等分する。 */
	get monthsPerPart(): number {
		return 12 / this.parts;
	}

	/**
	 * part 番目(1 から)の区切りの呼び方。part は区切った順番か保存値で、利用者の入力ではない。
	 * 範囲外はデータの不整合なので例外。
	 */
	partLabel(part: number): string {
		if (!Number.isInteger(part) || part < 1 || part > this.parts) {
			throw new Error(`${this.label}の区切りは 1〜${this.parts} 番目です。`);
		}
		return this.partLabels[part - 1];
	}

	toString(): PeriodDivisionValue {
		return this.value;
	}
}
