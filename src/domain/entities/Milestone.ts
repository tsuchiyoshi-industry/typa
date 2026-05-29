import { Score } from "../valueObjects/Score";

export class Milestone {
	constructor(
		public readonly id: number,
		public readonly sheetId: number,
		public readonly goalNumber: number,
		public readonly challengeGoal: string,
		public readonly midtermGoal: string,
		public readonly achievement: string,
		public readonly firstScore: Score,
		public readonly secondScore: Score,
	) {}

	static create(params: {
		id: number;
		sheetId: number;
		goalNumber: number;
		challengeGoal: string;
		midtermGoal: string;
		achievement: string;
		firstScore?: number;
		secondScore?: number;
	}): Milestone {
		return new Milestone(
			params.id,
			params.sheetId,
			params.goalNumber,
			params.challengeGoal ?? "",
			params.midtermGoal ?? "",
			params.achievement ?? "",
			Score.fromOptional(params.firstScore),
			Score.fromOptional(params.secondScore),
		);
	}

	withTextUpdates(params: {
		challengeGoal: string;
		midtermGoal: string;
		achievement: string;
	}): Milestone {
		return new Milestone(
			this.id,
			this.sheetId,
			this.goalNumber,
			params.challengeGoal,
			params.midtermGoal,
			params.achievement,
			this.firstScore,
			this.secondScore,
		);
	}

	withScoreUpdates(params: { firstScore?: number; secondScore?: number }): Milestone {
		return new Milestone(
			this.id,
			this.sheetId,
			this.goalNumber,
			this.challengeGoal,
			this.midtermGoal,
			this.achievement,
			params.firstScore !== undefined ? Score.from(params.firstScore) : this.firstScore,
			params.secondScore !== undefined ? Score.from(params.secondScore) : this.secondScore,
		);
	}
}
