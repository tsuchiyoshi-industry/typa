import { DomainError } from "../DomainError";
import { copyPeriodGoals, emptyPeriodGoals, type PeriodGoal } from "../valueObjects/PeriodGoal";
import { Score } from "../valueObjects/Score";

interface TextParams {
	challengeGoal?: string;
	periodGoals?: readonly PeriodGoal[];
	achievement?: string;
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
	) {
		if (periodGoals.length > 0 && achievement !== "") {
			throw new DomainError("期中目標があるときは、達成状況を期中目標ごとに記入してください。");
		}
	}

	static create(params: {
		id: number;
		sheetId: number;
		goalNumber: number;
		challengeGoal: string;
		periodGoals?: readonly PeriodGoal[];
		achievement?: string;
		firstScore?: number;
		secondScore?: number;
	}): Milestone {
		return new Milestone(
			params.id,
			params.sheetId,
			params.goalNumber,
			params.challengeGoal ?? "",
			copyPeriodGoals(params.periodGoals ?? emptyPeriodGoals()),
			params.achievement ?? "",
			Score.fromOptional(params.firstScore),
			Score.fromOptional(params.secondScore),
		);
	}

	/** 下書きの間の編集。指定しなかった欄は今のまま。 */
	withTextUpdates(params: TextParams): Milestone {
		return new Milestone(
			this.id,
			this.sheetId,
			this.goalNumber,
			params.challengeGoal ?? this.challengeGoal,
			copyPeriodGoals(params.periodGoals ?? this.periodGoals),
			params.achievement ?? this.achievement,
			this.firstScore,
			this.secondScore,
		);
	}

	/**
	 * 目標確定後の編集。チャレンジ目標と期中目標の本文・件数・順序は変えず、達成状況だけを変える
	 * (DB の goal_achievement_only と同じ)。
	 */
	withAchievementUpdates(params: TextParams): Milestone {
		const next = this.withTextUpdates(params);
		const sameDescriptions =
			next.periodGoals.length === this.periodGoals.length &&
			next.periodGoals.every((goal, i) => goal.description === this.periodGoals[i].description);
		if (next.challengeGoal !== this.challengeGoal || !sameDescriptions) {
			throw new DomainError("目標確定後は達成状況だけを編集できます。");
		}
		return next;
	}

	withScoreUpdates(params: { firstScore?: number; secondScore?: number }): Milestone {
		return new Milestone(
			this.id,
			this.sheetId,
			this.goalNumber,
			this.challengeGoal,
			this.periodGoals,
			this.achievement,
			params.firstScore !== undefined ? Score.from(params.firstScore) : this.firstScore,
			params.secondScore !== undefined ? Score.from(params.secondScore) : this.secondScore,
		);
	}
}
