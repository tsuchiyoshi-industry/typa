import { err, expectOk, ok, type Result } from "../Result";
import { emptyPeriodGoals, type PeriodGoal, toPeriodGoals } from "../valueObjects/PeriodGoal";
import { Score } from "../valueObjects/Score";
import { describeMilestoneError, type MilestoneError } from "./MilestoneError";

interface TextParams {
	challengeGoal?: string;
	periodGoals?: readonly PeriodGoal[];
	achievement?: string;
}

interface MilestoneParams {
	id: number;
	sheetId: number;
	goalNumber: number;
	challengeGoal: string;
	periodGoals?: readonly PeriodGoal[];
	achievement?: string;
	firstScore?: number;
	secondScore?: number;
}

/**
 * チャレンジ目標。達成状況は、期中目標があればタスクごとに、無ければチャレンジ目標に書く
 * (DB の milestones_achievement_placement と同じ)。
 */
export class Milestone {
	private constructor(
		public readonly id: number,
		public readonly sheetId: number,
		public readonly goalNumber: number,
		public readonly challengeGoal: string,
		public readonly periodGoals: readonly PeriodGoal[],
		/** チャレンジ目標の達成状況。期中目標があるときは空。 */
		public readonly achievement: string,
		public readonly firstScore: Score,
		public readonly secondScore: Score,
	) {}

	/** 入力から作る。期中目標の形と件数、達成状況の置き場所を確かめる。 */
	static from(params: MilestoneParams): Result<Milestone, MilestoneError> {
		const periodGoals = toPeriodGoals(params.periodGoals ?? emptyPeriodGoals());
		if (!periodGoals.ok) {
			return periodGoals;
		}
		const achievement = params.achievement ?? "";
		if (periodGoals.value.length > 0 && achievement !== "") {
			return err({ kind: "achievementBesideTasks" });
		}
		return ok(
			new Milestone(
				params.id,
				params.sheetId,
				params.goalNumber,
				params.challengeGoal ?? "",
				periodGoals.value,
				achievement,
				Score.fromOptional(params.firstScore),
				Score.fromOptional(params.secondScore),
			),
		);
	}

	/** 保存済みの目標を戻す。きまりに反していればデータの不整合として例外にする。 */
	static restore(params: MilestoneParams): Milestone {
		return expectOk(Milestone.from(params), describeMilestoneError);
	}

	/**
	 * 下書きの間の編集。指定しなかった欄は今のまま。達成状況は目標が確定してから書くので、新しい文は書けない
	 * (このきまりより前に書かれた文は、残すことと消すことだけできる。DB の milestone_achievements_kept と同じ)。
	 */
	withTextUpdates(params: TextParams): Result<Milestone, MilestoneError> {
		const next = this.withCorrectedText(params);
		if (!next.ok) {
			return next;
		}
		const written = new Set(this.achievements());
		return next.value.achievements().every((text) => written.has(text))
			? next
			: err({ kind: "achievementBeforeConfirmation" });
	}

	/** 書かれている達成状況(チャレンジ目標の達成状況と、期中目標ごとの達成状況)。空欄は含めない。 */
	private achievements(): string[] {
		return [this.achievement, ...this.periodGoals.map((goal) => goal.achievement)].filter(
			(text) => text.trim() !== "",
		);
	}

	/**
	 * 指定しなかった欄は今のままにした目標。状態による制限は掛けない(締め後修正で、管理担当者が記録を直すときに使う)。
	 */
	withCorrectedText(params: TextParams): Result<Milestone, MilestoneError> {
		return Milestone.from({
			id: this.id,
			sheetId: this.sheetId,
			goalNumber: this.goalNumber,
			challengeGoal: params.challengeGoal ?? this.challengeGoal,
			periodGoals: params.periodGoals ?? this.periodGoals,
			achievement: params.achievement ?? this.achievement,
			firstScore: this.firstScore.toNumber(),
			secondScore: this.secondScore.toNumber(),
		});
	}

	/**
	 * 目標の送信後の編集。チャレンジ目標と期中目標の本文・件数・順序は変えず、達成状況だけを変える
	 * (DB の goal_achievement_only と同じ)。
	 */
	withAchievementUpdates(params: TextParams): Result<Milestone, MilestoneError> {
		const next = this.withCorrectedText(params);
		if (!next.ok) {
			return next;
		}
		const goals = next.value.periodGoals;
		const sameDescriptions =
			goals.length === this.periodGoals.length &&
			goals.every((goal, i) => goal.description === this.periodGoals[i].description);
		return next.value.challengeGoal === this.challengeGoal && sameDescriptions
			? next
			: err({ kind: "goalsFixed" });
	}
}
