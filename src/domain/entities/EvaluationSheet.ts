import { EvaluationAllocatedScores } from "../valueObjects/EvaluationAllocatedScores";
import { EvaluationAllocation } from "../valueObjects/EvaluationAllocation";
import { EvaluationRank } from "../valueObjects/EvaluationRank";
import { EvaluationScoreTotals } from "../valueObjects/EvaluationScoreTotals";
import { EvaluationStatus } from "../valueObjects/EvaluationStatus";
import type { CommonEvaluationResult } from "./CommonEvaluationResult";
import type { Employee } from "./Employee";
import type { EvaluationPeriod } from "./EvaluationPeriod";
import type { Milestone } from "./Milestone";

export class EvaluationSheet {
	constructor(
		public readonly sheetId: number,
		public readonly subject: Employee,
		public readonly evaluationPeriod: EvaluationPeriod,
		public readonly primaryEvaluatorName: string,
		public readonly secondaryEvaluatorName: string,
		public readonly firstOverallComment: string,
		public readonly secondOverallComment: string,
		public readonly objectives: Milestone[],
		public readonly commonEvaluationResults: CommonEvaluationResult[],
		public readonly objectiveScoreTotals: EvaluationScoreTotals,
		public readonly commonEvaluationScoreTotals: EvaluationScoreTotals,
		public readonly allocatedScores: EvaluationAllocatedScores,
		public readonly status: EvaluationStatus,
		/** 確定時に保存したランク。未確定の段階では undefined、または過去の手入力値が残っていることがある。 */
		public readonly finalEvaluationRank?: EvaluationRank,
		public readonly firstEvaluationRank?: EvaluationRank,
		/** 評価点の配点。確定済みのシートは確定時の配点、それ以外は現在の設定。 */
		public readonly allocation: EvaluationAllocation = EvaluationAllocation.DEFAULT,
	) {}

	static create(params: {
		sheetId: number;
		subject: Employee;
		evaluationPeriod: EvaluationPeriod;
		primaryEvaluatorName: string;
		secondaryEvaluatorName: string;
		firstOverallComment?: string;
		secondOverallComment?: string;
		objectives: Milestone[];
		commonEvaluationResults?: CommonEvaluationResult[];
		objectiveScoreTotals?: EvaluationScoreTotals;
		commonEvaluationScoreTotals?: EvaluationScoreTotals;
		allocatedScores?: EvaluationAllocatedScores;
		status?: EvaluationStatus;
		finalEvaluationRank?: EvaluationRank;
		firstEvaluationRank?: EvaluationRank;
		allocation?: EvaluationAllocation;
	}): EvaluationSheet {
		const commonEvaluationResults = params.commonEvaluationResults ?? [];
		const objectiveScoreTotals =
			params.objectiveScoreTotals ?? EvaluationScoreTotals.fromObjectives(params.objectives);
		const commonEvaluationScoreTotals =
			params.commonEvaluationScoreTotals ??
			EvaluationScoreTotals.fromCommonEvaluationResults(commonEvaluationResults);
		return new EvaluationSheet(
			params.sheetId,
			params.subject,
			params.evaluationPeriod,
			params.primaryEvaluatorName,
			params.secondaryEvaluatorName,
			params.firstOverallComment ?? "",
			params.secondOverallComment ?? "",
			params.objectives,
			commonEvaluationResults,
			objectiveScoreTotals,
			commonEvaluationScoreTotals,
			params.allocatedScores ??
				EvaluationAllocatedScores.fromTotals(
					objectiveScoreTotals,
					commonEvaluationScoreTotals,
					params.subject.primaryIsFinalEvaluator(),
					params.allocation,
				),
			params.status ?? EvaluationStatus.DRAFT,
			params.finalEvaluationRank,
			params.firstEvaluationRank,
			params.allocation,
		);
	}

	/** 二次評価者「なし」の社員は、一次評価者が最終評価者を兼ねる。 */
	primaryIsFinalEvaluator(): boolean {
		return this.subject.primaryIsFinalEvaluator();
	}

	/** 確定する評価者自身の、まだ評価されていない項目。0 は未評価。 */
	pendingEvaluationItems(stage: "first" | "second"): string[] {
		const scoreKey = stage === "first" ? "firstScore" : "secondScore";
		return [
			...this.objectives
				.filter((objective) => objective[scoreKey].toNumber() === 0)
				.map((objective) => `チャレンジ目標 ${objective.goalNumber}`),
			...this.commonEvaluationResults
				.filter((result) => result[scoreKey].toNumber() === 0)
				.map((result) => `共通評価「${result.item.title}」`),
		];
	}

	/** 一次評価の評価点(チャレンジ目標と共通評価の得点率に、それぞれの配点を掛けた合計)。 */
	firstEvaluationScore(): number {
		return EvaluationAllocatedScores.fromTotals(
			this.objectiveScoreTotals,
			this.commonEvaluationScoreTotals,
			true,
			this.allocation,
		).totalEvaluationScore;
	}

	/** 一次評価ランク。一次評価の確定後は保存値、確定前は現在の点数から決まる見込み。 */
	resolveFirstEvaluationRank(): EvaluationRank {
		return (
			(this.status.isFirstEvaluationConfirmed() ? this.firstEvaluationRank : undefined) ??
			EvaluationRank.fromScore(this.firstEvaluationScore(), EvaluationAllocation.TOTAL)
		);
	}

	/** 最終評価ランク。最終評価者(二次評価者。「なし」の社員は一次評価者)の評価点から決まる。 */
	resolveFinalEvaluationRank(): EvaluationRank {
		return (
			(this.status.isFinalized() ? this.finalEvaluationRank : undefined) ??
			EvaluationRank.fromScore(
				this.allocatedScores.totalEvaluationScore,
				EvaluationAllocation.TOTAL,
			)
		);
	}

	isEditable(): boolean {
		return this.status.isDraft();
	}

	equals(other: EvaluationSheet): boolean {
		return this.sheetId === other.sheetId;
	}
}
