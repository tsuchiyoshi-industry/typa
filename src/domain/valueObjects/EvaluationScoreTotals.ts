import type { CommonEvaluationResult } from "../entities/CommonEvaluationResult";
import type { Milestone } from "../entities/Milestone";
import { EvaluationAllocation, toNonNegativeInteger } from "./EvaluationAllocation";
import { Score } from "./Score";

export class EvaluationScoreTotals {
	private constructor(
		public readonly firstTotalScore: number,
		public readonly firstTotalRate: number,
		public readonly secondTotalScore: number,
		public readonly secondTotalRate: number,
		private readonly maxTotalScore: number | null = null,
	) {}

	static fromValues(params: {
		firstTotalScore?: number | null;
		firstTotalRate?: number | null;
		secondTotalScore?: number | null;
		secondTotalRate?: number | null;
		maxTotalScore?: number | null;
	}): EvaluationScoreTotals {
		return new EvaluationScoreTotals(
			toNonNegativeInteger(params.firstTotalScore),
			toNonNegativeInteger(params.firstTotalRate),
			toNonNegativeInteger(params.secondTotalScore),
			toNonNegativeInteger(params.secondTotalRate),
			params.maxTotalScore == null ? null : toNonNegativeInteger(params.maxTotalScore),
		);
	}

	/**
	 * 各項目を 1〜4 で評価し、「配点 × 評価」をその項目の得点、「配点 × 4」を満点とする。
	 * チャレンジ目標は配点 1、共通評価は項目の配点(係数)。配点 1 の項目が 10 個なら満点は 40 点。
	 */
	static fromWeightedScores(
		items: readonly { weight: number; firstScore: number; secondScore: number }[],
	): EvaluationScoreTotals {
		const sum = (score: (item: (typeof items)[number]) => number) =>
			items.reduce((total, item) => total + item.weight * score(item), 0);
		const firstTotalScore = sum((item) => item.firstScore);
		const secondTotalScore = sum((item) => item.secondScore);
		const maxTotalScore = sum(() => Score.MAX);
		return new EvaluationScoreTotals(
			firstTotalScore,
			EvaluationScoreTotals.toRate(firstTotalScore, maxTotalScore),
			secondTotalScore,
			EvaluationScoreTotals.toRate(secondTotalScore, maxTotalScore),
			maxTotalScore || null,
		);
	}

	static fromObjectives(objectives: readonly Milestone[]): EvaluationScoreTotals {
		return EvaluationScoreTotals.fromWeightedScores(
			objectives.map((objective) => ({
				weight: 1,
				firstScore: objective.firstScore.toNumber(),
				secondScore: objective.secondScore.toNumber(),
			})),
		);
	}

	static fromCommonEvaluationResults(
		results: readonly CommonEvaluationResult[],
	): EvaluationScoreTotals {
		return EvaluationScoreTotals.fromWeightedScores(
			results.map((result) => ({
				weight: result.item.weight,
				firstScore: result.firstScore.toNumber(),
				secondScore: result.secondScore.toNumber(),
			})),
		);
	}

	/** 表示・保存用の整数の得点率ではなく、合計点と満点から換算する。 */
	scoreFor(allocation: number, useFirst = false): number {
		return this.maxTotalScore == null
			? EvaluationAllocation.toScore(
					allocation,
					useFirst ? this.firstTotalRate : this.secondTotalRate,
				)
			: EvaluationAllocation.fromTotal(
					allocation,
					useFirst ? this.firstTotalScore : this.secondTotalScore,
					this.maxTotalScore,
				);
	}

	private static toRate(totalScore: number, maxTotalScore: number): number {
		if (maxTotalScore <= 0) {
			return 0;
		}
		return Math.round((totalScore / maxTotalScore) * 100);
	}
}
