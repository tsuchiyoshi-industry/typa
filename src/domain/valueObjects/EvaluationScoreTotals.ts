import type { CommonEvaluationResult } from "../entities/CommonEvaluationResult";
import type { Milestone } from "../entities/Milestone";

export class EvaluationScoreTotals {
	private constructor(
		public readonly firstTotalScore: number,
		public readonly firstTotalRate: number,
		public readonly secondTotalScore: number,
		public readonly secondTotalRate: number,
	) {}

	static zero(): EvaluationScoreTotals {
		return new EvaluationScoreTotals(0, 0, 0, 0);
	}

	static fromValues(params: {
		firstTotalScore?: number | null;
		firstTotalRate?: number | null;
		secondTotalScore?: number | null;
		secondTotalRate?: number | null;
	}): EvaluationScoreTotals {
		return new EvaluationScoreTotals(
			EvaluationScoreTotals.toNonNegativeInteger(params.firstTotalScore),
			EvaluationScoreTotals.toNonNegativeInteger(params.firstTotalRate),
			EvaluationScoreTotals.toNonNegativeInteger(params.secondTotalScore),
			EvaluationScoreTotals.toNonNegativeInteger(params.secondTotalRate),
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
		const maxTotalScore = objectives.length * 4;

		return new EvaluationScoreTotals(
			firstTotalScore,
			EvaluationScoreTotals.toRate(firstTotalScore, maxTotalScore),
			secondTotalScore,
			EvaluationScoreTotals.toRate(secondTotalScore, maxTotalScore),
		);
	}

	static fromCommonEvaluationResults(results: CommonEvaluationResult[]): EvaluationScoreTotals {
		const firstTotalScore = results.reduce((sum, result) => sum + result.firstScore.toNumber(), 0);
		const secondTotalScore = results.reduce(
			(sum, result) => sum + result.secondScore.toNumber(),
			0,
		);
		const maxTotalScore = results.reduce((sum, result) => sum + result.item.weight, 0);

		return new EvaluationScoreTotals(
			firstTotalScore,
			EvaluationScoreTotals.toRate(firstTotalScore, maxTotalScore),
			secondTotalScore,
			EvaluationScoreTotals.toRate(secondTotalScore, maxTotalScore),
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
