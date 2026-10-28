import { err, ok, type Result } from "../Result";
import { EvaluationAllocatedScores } from "../valueObjects/EvaluationAllocatedScores";
import { EvaluationAllocation } from "../valueObjects/EvaluationAllocation";
import { EvaluationRank } from "../valueObjects/EvaluationRank";
import { EvaluationScoreTotals } from "../valueObjects/EvaluationScoreTotals";
import { EvaluationStatus, type SheetActor } from "../valueObjects/EvaluationStatus";
import type { CommonEvaluationResult } from "./CommonEvaluationResult";
import type { Employee } from "./Employee";
import type { EvaluationPeriod } from "./EvaluationPeriod";
import type { Milestone } from "./Milestone";
import type { SheetCorrection } from "./SheetCorrection";
import type { SheetTransitionError } from "./SheetTransitionError";

/** DB に保存された集計値と配点。点数を保存したときの項目・満点・配点で計算したもの。 */
export interface StoredSheetScores {
	objectivesFirstTotalScore?: number | null;
	objectivesFirstTotalRate?: number | null;
	objectivesSecondTotalScore?: number | null;
	objectivesSecondTotalRate?: number | null;
	commonEvaluationFirstTotalScore?: number | null;
	commonEvaluationFirstTotalRate?: number | null;
	commonEvaluationSecondTotalScore?: number | null;
	commonEvaluationSecondTotalRate?: number | null;
	objectivesSecondEvaluationScore?: number | null;
	commonEvaluationSecondEvaluationScore?: number | null;
	totalEvaluationScore?: number | null;
	objectiveAllocation?: number | null;
	commonAllocation?: number | null;
}

type CreateParams = Parameters<typeof EvaluationSheet.create>[0];

const anyStored = (...values: (number | null | undefined)[]) =>
	values.some((value) => value != null);

export class EvaluationSheet {
	constructor(
		public readonly sheetId: number,
		/**
		 * 被評価者。評価者(一次・二次・二次評価者「なし」)は、社員マスタの今の評価者ではなく、
		 * このシートが持つ評価者。未確定の間は社員マスタの変更に追従し、確定後は変わらない。
		 */
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
		/**
		 * シートを作成したときの等級。共通評価の項目と帳票の等級はこれで決まり、その後に社員の等級が
		 * 変わっても変わらない。未設定の社員のシートは null。
		 */
		public readonly gradeId: number | null = null,
		/** 1枚のシートに置けるチャレンジ目標の数の上限(設定値)。 */
		public readonly maxObjectives: number = EvaluationSheet.DEFAULT_MAX_OBJECTIVES,
		/**
		 * 被評価者の社員マスタ上の今の評価者。シートの評価者とは別で、異動で新しく評価者になった人も含む。
		 * この人たちは、確定したシートを評価の記録として読める。
		 */
		public readonly currentEvaluatorIds: readonly number[] = [],
		/** 締め後修正(遡及処理)の記録。古い順。 */
		public readonly corrections: readonly SheetCorrection[] = [],
		/**
		 * 次に評価する人へメールで知らせるか(通知の方法がメール)。false ならアプリ内通知で、
		 * 状態の変更と同時に DB が知らせる。設定を読まずに作るシート(テストなど)は、メールで知らせる。
		 */
		public readonly notifiesByMail: boolean = true,
		/** 一次評価者が目標を差し戻したときの理由。下書きの間だけあり、それ以外は空。 */
		public readonly goalReturnReason: string = "",
	) {}

	/** 設定を読まずにシートを作るとき(テストなど)の上限。DB の初期値と同じ。 */
	static readonly DEFAULT_MAX_OBJECTIVES = 4;

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
		/** 省略すると、社員の今の等級(新しく作るシートと同じ)。 */
		gradeId?: number | null;
		maxObjectives?: number;
		currentEvaluatorIds?: readonly number[];
		corrections?: readonly SheetCorrection[];
		notifiesByMail?: boolean;
		goalReturnReason?: string;
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
			params.gradeId === undefined ? params.subject.gradeId : params.gradeId,
			params.maxObjectives,
			params.currentEvaluatorIds,
			params.corrections,
			params.notifiesByMail,
			params.goalReturnReason,
		);
	}

	/**
	 * 確定済みのシートは確定時の配点を使い、後から設定を変えても確定した評価点と食い違わないようにする。
	 * undefined のときは、現在の設定の配点で計算する。
	 */
	static storedAllocation(
		status: EvaluationStatus,
		stored: StoredSheetScores,
	): EvaluationAllocation | undefined {
		return status.isFinalized() &&
			stored.objectiveAllocation != null &&
			stored.commonAllocation != null
			? EvaluationAllocation.of(stored.objectiveAllocation, stored.commonAllocation)
			: undefined;
	}

	/**
	 * 保存されたシートを復元する。保存されている合計・得点率・評価点は、点数を保存したときの項目・満点で
	 * 計算したもの。等級や項目が変わると実際の点数と食い違うので、確定済みのシートだけがそれを使う
	 * (満点は渡さず、保存時の得点率で換算する)。未確定のシートは、いまの点数と評価者設定から計算し直す。
	 */
	static restore(
		params: Omit<
			CreateParams,
			"objectiveScoreTotals" | "commonEvaluationScoreTotals" | "allocatedScores" | "status"
		> & { status: EvaluationStatus; stored: StoredSheetScores },
	): EvaluationSheet {
		const { stored, ...rest } = params;
		const finalized = params.status.isFinalized();
		return EvaluationSheet.create({
			...rest,
			objectiveScoreTotals:
				finalized &&
				anyStored(
					stored.objectivesFirstTotalScore,
					stored.objectivesFirstTotalRate,
					stored.objectivesSecondTotalScore,
					stored.objectivesSecondTotalRate,
				)
					? EvaluationScoreTotals.fromValues({
							firstTotalScore: stored.objectivesFirstTotalScore,
							firstTotalRate: stored.objectivesFirstTotalRate,
							secondTotalScore: stored.objectivesSecondTotalScore,
							secondTotalRate: stored.objectivesSecondTotalRate,
						})
					: undefined,
			commonEvaluationScoreTotals:
				finalized &&
				anyStored(
					stored.commonEvaluationFirstTotalScore,
					stored.commonEvaluationFirstTotalRate,
					stored.commonEvaluationSecondTotalScore,
					stored.commonEvaluationSecondTotalRate,
				)
					? EvaluationScoreTotals.fromValues({
							firstTotalScore: stored.commonEvaluationFirstTotalScore,
							firstTotalRate: stored.commonEvaluationFirstTotalRate,
							secondTotalScore: stored.commonEvaluationSecondTotalScore,
							secondTotalRate: stored.commonEvaluationSecondTotalRate,
						})
					: undefined,
			// 確定済みは確定時の保存値を使い、その後の評価者の付け替えに左右されないようにする
			allocatedScores:
				finalized &&
				anyStored(
					stored.objectivesSecondEvaluationScore,
					stored.commonEvaluationSecondEvaluationScore,
					stored.totalEvaluationScore,
				)
					? EvaluationAllocatedScores.fromValues({
							objectiveSecondRate: stored.objectivesSecondTotalRate,
							objectiveEvaluationScore: stored.objectivesSecondEvaluationScore,
							commonEvaluationSecondRate: stored.commonEvaluationSecondTotalRate,
							commonEvaluationEvaluationScore: stored.commonEvaluationSecondEvaluationScore,
							totalEvaluationScore: stored.totalEvaluationScore,
							allocation: params.allocation,
						})
					: undefined,
			status: params.status,
		});
	}

	/** 二次評価者「なし」の社員は、一次評価者が最終評価者を兼ねる。 */
	primaryIsFinalEvaluator(): boolean {
		return this.subject.primaryIsFinalEvaluator();
	}

	/** 送信・確定にはテーマが必要。期中目標は0〜4件で、達成状況の記入は求めない。 */
	pendingObjectiveFields(): string[] {
		if (this.objectives.length < 1 || this.objectives.length > this.maxObjectives) {
			return [`チャレンジ目標は1〜${this.maxObjectives}件必要です。`];
		}
		return this.objectives
			.filter((objective) => !objective.challengeGoal.trim())
			.map((objective) => `目標 ${objective.goalNumber}：チャレンジ目標`);
	}

	/**
	 * その状態へ進める前に、中身がそろっているか。足りなければ、足りないものを挙げて返す。
	 * 送信・目標確定・一次評価の依頼にはすべてのチャレンジ目標が、確定には確定する評価者自身の全項目の点数が要る。
	 * 下書きへ戻すときは問わない。DB のトリガー check_evaluation_completion も同じ検査をする。
	 */
	readinessFor(status: EvaluationStatus): Result<void, SheetTransitionError> {
		if (!status.isSentToEvaluators()) {
			return ok(undefined);
		}
		const missing = this.pendingObjectiveFields();
		if (missing.length > 0) {
			return err({ kind: "objectivesIncomplete", missing });
		}
		if (status.isFirstEvaluationConfirmed()) {
			const stage = this.confirmingStage(status);
			const pending = this.pendingEvaluationItems(stage);
			if (pending.length > 0) {
				return err({ kind: "evaluationIncomplete", stage, pending });
			}
		}
		return ok(undefined);
	}

	/** その状態への変更で評価を確定するのはどちらの評価者か。二次評価者「なし」なら一次が最終を兼ねる。 */
	confirmingStage(status: EvaluationStatus): "first" | "second" {
		return status.isFinalized() && !this.primaryIsFinalEvaluator() ? "second" : "first";
	}

	/** 確定する評価者自身の、まだ評価されていない項目。0 は未評価。 */
	pendingEvaluationItems(stage: "first" | "second"): string[] {
		return this.pendingEvaluationTargets(stage).map((target) => target.label);
	}

	/** pendingEvaluationItems に、その項目がどれか(目標の番号・共通評価の項目)を付けたもの。 */
	pendingEvaluationTargets(
		stage: "first" | "second",
	): { label: string; goalNumber?: number; itemId?: number }[] {
		const scoreKey = stage === "first" ? "firstScore" : "secondScore";
		return [
			...this.objectives
				.filter((objective) => objective[scoreKey].toNumber() === 0)
				.map((objective) => ({
					label: `チャレンジ目標 ${objective.goalNumber}`,
					goalNumber: objective.goalNumber,
				})),
			...this.commonEvaluationResults
				.filter((result) => result[scoreKey].toNumber() === 0)
				.map((result) => ({ label: `共通評価「${result.item.title}」`, itemId: result.itemId })),
		];
	}

	/**
	 * いまボールを持っている人と、その名前。二次評価者「なし」の社員の一次評価済み(以前のデータ)は、
	 * 一次評価者が最終評価者として持つ。評価確定は null。
	 */
	currentHolder(): { actor: SheetActor; name: string } | null {
		const actor =
			this.status.isAwaitingSecondEvaluation() && this.primaryIsFinalEvaluator()
				? "primary"
				: this.status.holder();
		if (!actor) {
			return null;
		}
		const names = {
			subject: this.subject.name,
			primary: this.primaryEvaluatorName,
			secondary: this.secondaryEvaluatorName,
		};
		return { actor, name: names[actor] };
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

	/** 状態だけを変えた写し。保存は DB が行い、ここでは変更後の判断(通知など)に使う。 */
	withStatus(status: EvaluationStatus): EvaluationSheet {
		return new EvaluationSheet(
			this.sheetId,
			this.subject,
			this.evaluationPeriod,
			this.primaryEvaluatorName,
			this.secondaryEvaluatorName,
			this.firstOverallComment,
			this.secondOverallComment,
			this.objectives,
			this.commonEvaluationResults,
			this.objectiveScoreTotals,
			this.commonEvaluationScoreTotals,
			this.allocatedScores,
			status,
			this.finalEvaluationRank,
			this.firstEvaluationRank,
			this.allocation,
			this.gradeId,
			this.maxObjectives,
			this.currentEvaluatorIds,
			this.corrections,
			this.notifiesByMail,
			// 下書きを離れると、DB が理由を消す
			status.isDraft() ? this.goalReturnReason : "",
		);
	}

	equals(other: EvaluationSheet): boolean {
		return this.sheetId === other.sheetId;
	}
}
