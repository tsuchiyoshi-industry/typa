import { EvaluationAllocation } from "./EvaluationAllocation";
import type { EvaluationScoreTotals } from "./EvaluationScoreTotals";

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
	 * チャレンジ目標は「点数の合計 ÷ (目標数 × 4)」、共通評価は「点数の合計 ÷ 配点の合計」が獲得率で、
	 * それぞれに allocation の配点を掛ける。等級によって共通評価の項目数が違っても、配点は同じになる。
	 */
	static fromTotals(
		objectiveScoreTotals: EvaluationScoreTotals,
		commonEvaluationScoreTotals: EvaluationScoreTotals,
		primaryIsFinal = false,
		allocation = EvaluationAllocation.DEFAULT,
	): EvaluationAllocatedScores {
		const objectiveRate = primaryIsFinal
			? objectiveScoreTotals.firstTotalRate
			: objectiveScoreTotals.secondTotalRate;
		const commonEvaluationRate = primaryIsFinal
			? commonEvaluationScoreTotals.firstTotalRate
			: commonEvaluationScoreTotals.secondTotalRate;
		const objectiveEvaluationScore = objectiveScoreTotals.scoreFor(
			allocation.objective,
			primaryIsFinal,
		);
		const commonEvaluationEvaluationScore = commonEvaluationScoreTotals.scoreFor(
			allocation.common,
			primaryIsFinal,
		);

		return new EvaluationAllocatedScores(
			allocation.objective,
			objectiveRate,
			objectiveEvaluationScore,
			allocation.common,
			commonEvaluationRate,
			commonEvaluationEvaluationScore,
			objectiveEvaluationScore + commonEvaluationEvaluationScore,
		);
	}

	/** 保存済みの値から復元する。allocation は、その値を計算したときの配点。 */
	static fromValues(params: {
		objectiveSecondRate?: number | null;
		objectiveEvaluationScore?: number | null;
		commonEvaluationSecondRate?: number | null;
		commonEvaluationEvaluationScore?: number | null;
		totalEvaluationScore?: number | null;
		allocation?: EvaluationAllocation;
	}): EvaluationAllocatedScores {
		const allocation = params.allocation ?? EvaluationAllocation.DEFAULT;
		const objectiveSecondRate = EvaluationAllocatedScores.toNonNegativeInteger(
			params.objectiveSecondRate,
		);
		const commonEvaluationSecondRate = EvaluationAllocatedScores.toNonNegativeInteger(
			params.commonEvaluationSecondRate,
		);
		const objectiveEvaluationScore =
			params.objectiveEvaluationScore == null
				? EvaluationAllocation.toScore(allocation.objective, objectiveSecondRate)
				: EvaluationAllocatedScores.toNonNegativeInteger(params.objectiveEvaluationScore);
		const commonEvaluationEvaluationScore =
			params.commonEvaluationEvaluationScore == null
				? EvaluationAllocation.toScore(allocation.common, commonEvaluationSecondRate)
				: EvaluationAllocatedScores.toNonNegativeInteger(params.commonEvaluationEvaluationScore);

		return new EvaluationAllocatedScores(
			allocation.objective,
			objectiveSecondRate,
			objectiveEvaluationScore,
			allocation.common,
			commonEvaluationSecondRate,
			commonEvaluationEvaluationScore,
			params.totalEvaluationScore == null
				? objectiveEvaluationScore + commonEvaluationEvaluationScore
				: EvaluationAllocatedScores.toNonNegativeInteger(params.totalEvaluationScore),
		);
	}

	private static toNonNegativeInteger(value?: number | null): number {
		if (!Number.isFinite(value) || value == null || value < 0) {
			return 0;
		}
		return Math.round(value);
	}
}
