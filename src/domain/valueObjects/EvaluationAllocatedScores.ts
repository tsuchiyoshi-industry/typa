import type { EvaluationScoreTotals } from "./EvaluationScoreTotals";

export const OBJECTIVE_EVALUATION_ALLOCATION_SCORE = 20;
export const COMMON_EVALUATION_ALLOCATION_SCORE = 80;
/** 評価点の満点。評価ランクはこの満点に対する得点率で決まる。 */
export const TOTAL_EVALUATION_ALLOCATION_SCORE =
	OBJECTIVE_EVALUATION_ALLOCATION_SCORE + COMMON_EVALUATION_ALLOCATION_SCORE;

export class EvaluationAllocatedScores {
	private constructor(
		public readonly objectiveAllocationScore: number,
		public readonly objectiveSecondRate: number,
		public readonly objectiveEvaluationScore: number,
		public readonly commonEvaluationAllocationScore: number,
		public readonly commonEvaluationSecondRate: number,
		public readonly commonEvaluationEvaluationScore: number,
		public readonly totalEvaluationScore: number,
	) {}

	static zero(): EvaluationAllocatedScores {
		return EvaluationAllocatedScores.fromValues({});
	}

	/**
	 * 最終評価の獲得率から評価点を出す。最終評価は二次評価で、
	 * 二次評価者「なし」の社員(primaryIsFinal)は一次評価をそのまま(100%)使う。
	 * SecondRate と付く値は「最終評価に使った獲得率」を指す。
	 */
	static fromTotals(
		objectiveScoreTotals: EvaluationScoreTotals,
		commonEvaluationScoreTotals: EvaluationScoreTotals,
		primaryIsFinal = false,
	): EvaluationAllocatedScores {
		const objectiveRate = primaryIsFinal
			? objectiveScoreTotals.firstTotalRate
			: objectiveScoreTotals.secondTotalRate;
		const commonEvaluationRate = primaryIsFinal
			? commonEvaluationScoreTotals.firstTotalRate
			: commonEvaluationScoreTotals.secondTotalRate;
		const objectiveEvaluationScore = EvaluationAllocatedScores.toEvaluationScore(
			OBJECTIVE_EVALUATION_ALLOCATION_SCORE,
			objectiveRate,
		);
		const commonEvaluationEvaluationScore = EvaluationAllocatedScores.toEvaluationScore(
			COMMON_EVALUATION_ALLOCATION_SCORE,
			commonEvaluationRate,
		);

		return new EvaluationAllocatedScores(
			OBJECTIVE_EVALUATION_ALLOCATION_SCORE,
			objectiveRate,
			objectiveEvaluationScore,
			COMMON_EVALUATION_ALLOCATION_SCORE,
			commonEvaluationRate,
			commonEvaluationEvaluationScore,
			objectiveEvaluationScore + commonEvaluationEvaluationScore,
		);
	}

	static fromValues(params: {
		objectiveSecondRate?: number | null;
		objectiveEvaluationScore?: number | null;
		commonEvaluationSecondRate?: number | null;
		commonEvaluationEvaluationScore?: number | null;
		totalEvaluationScore?: number | null;
	}): EvaluationAllocatedScores {
		const objectiveSecondRate = EvaluationAllocatedScores.toNonNegativeInteger(
			params.objectiveSecondRate,
		);
		const commonEvaluationSecondRate = EvaluationAllocatedScores.toNonNegativeInteger(
			params.commonEvaluationSecondRate,
		);
		const objectiveEvaluationScore =
			params.objectiveEvaluationScore == null
				? EvaluationAllocatedScores.toEvaluationScore(
						OBJECTIVE_EVALUATION_ALLOCATION_SCORE,
						objectiveSecondRate,
					)
				: EvaluationAllocatedScores.toNonNegativeInteger(params.objectiveEvaluationScore);
		const commonEvaluationEvaluationScore =
			params.commonEvaluationEvaluationScore == null
				? EvaluationAllocatedScores.toEvaluationScore(
						COMMON_EVALUATION_ALLOCATION_SCORE,
						commonEvaluationSecondRate,
					)
				: EvaluationAllocatedScores.toNonNegativeInteger(params.commonEvaluationEvaluationScore);

		return new EvaluationAllocatedScores(
			OBJECTIVE_EVALUATION_ALLOCATION_SCORE,
			objectiveSecondRate,
			objectiveEvaluationScore,
			COMMON_EVALUATION_ALLOCATION_SCORE,
			commonEvaluationSecondRate,
			commonEvaluationEvaluationScore,
			params.totalEvaluationScore == null
				? objectiveEvaluationScore + commonEvaluationEvaluationScore
				: EvaluationAllocatedScores.toNonNegativeInteger(params.totalEvaluationScore),
		);
	}

	private static toEvaluationScore(allocationScore: number, rate: number): number {
		return Math.round((allocationScore * rate) / 100);
	}

	private static toNonNegativeInteger(value?: number | null): number {
		if (!Number.isFinite(value) || value == null || value < 0) {
			return 0;
		}
		return Math.round(value);
	}
}
