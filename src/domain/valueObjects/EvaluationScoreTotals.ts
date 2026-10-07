import type { CommonEvaluationResult } from "../entities/CommonEvaluationResult";
import type { Milestone } from "../entities/Milestone";
import { EvaluationAllocation } from "./EvaluationAllocation";
import { Score } from "./Score";

export class EvaluationScoreTotals {
	private constructor(
		public readonly firstTotalScore: number,
		public readonly firstTotalRate: number,
		public readonly secondTotalScore: number,
		public readonly secondTotalRate: number,
		private readonly maxTotalScore: number | null = null,
	) {}

	static zero(): EvaluationScoreTotals {
		return new EvaluationScoreTotals(0, 0, 0, 0);
	}

	static fromValues(params: {
		firstTotalScore?: number | null;
		firstTotalRate?: number | null;
		secondTotalScore?: number | null;
		secondTotalRate?: number | null;
		maxTotalScore?: number | null;
	}): EvaluationScoreTotals {
		return new EvaluationScoreTotals(
			EvaluationScoreTotals.toNonNegativeInteger(params.firstTotalScore),
			EvaluationScoreTotals.toNonNegativeInteger(params.firstTotalRate),
			EvaluationScoreTotals.toNonNegativeInteger(params.secondTotalScore),
			EvaluationScoreTotals.toNonNegativeInteger(params.secondTotalRate),
			params.maxTotalScore == null
				? null
				: EvaluationScoreTotals.toNonNegativeInteger(params.maxTotalScore),
		);
	}

	static fromObjectives(objectives: Milestone[]): EvaluationScoreTotals {
		const firstTotalScore = objectives.reduce(
			(sum, objective) => sum + objective.firstScore.toNumber(),
			0,
		);
		const secondTotalScore = objectives.reduce(
			(sum, objective) => sum + objective.secondScore.toNumber(),
			0,
		);
		const maxTotalScore = objectives.length * Score.MAX;

		return new EvaluationScoreTotals(
			firstTotalScore,
			EvaluationScoreTotals.toRate(firstTotalScore, maxTotalScore),
			secondTotalScore,
			EvaluationScoreTotals.toRate(secondTotalScore, maxTotalScore),
			maxTotalScore || null,
		);
	}

	/**
	 * 共通評価の項目の配点は係数。各項目を 1〜4 で評価し、「配点 × 評価」がその項目の得点、
	 * 「配点 × 4」が満点になる。配点 1 の項目が 10 個なら満点は 40 点。
	 */
	static fromCommonEvaluationResults(results: CommonEvaluationResult[]): EvaluationScoreTotals {
		const firstTotalScore = results.reduce(
			(sum, result) => sum + result.item.weight * result.firstScore.toNumber(),
			0,
		);
		const secondTotalScore = results.reduce(
			(sum, result) => sum + result.item.weight * result.secondScore.toNumber(),
			0,
		);
		const maxTotalScore = results.reduce((sum, result) => sum + result.item.weight * Score.MAX, 0);

		return new EvaluationScoreTotals(
			firstTotalScore,
			EvaluationScoreTotals.toRate(firstTotalScore, maxTotalScore),
			secondTotalScore,
			EvaluationScoreTotals.toRate(secondTotalScore, maxTotalScore),
			maxTotalScore || null,
		);
	}

	/** 二次評価者「なし」の社員の確定値: 一次評価の合計をそのまま最終(二次)の合計として扱う。 */
	withFirstAsFinal(): EvaluationScoreTotals {
		return new EvaluationScoreTotals(
			this.firstTotalScore,
			this.firstTotalRate,
			this.firstTotalScore,
			this.firstTotalRate,
			this.maxTotalScore,
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

	private static toNonNegativeInteger(value?: number | null): number {
		if (!Number.isFinite(value) || value == null || value < 0) {
			return 0;
		}
		return Math.round(value);
	}
}
