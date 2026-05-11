import { Comment } from "../valueObjects/Comment";
import { Score } from "../valueObjects/Score";
import type { CommonEvaluationItem } from "./CommonEvaluationItem";

export class CommonEvaluationResult {
	constructor(
		public readonly id: number,
		public readonly sheetId: number,
		public readonly itemId: number,
		public readonly firstScore: Score,
		public readonly secondScore: Score,
		public readonly firstComment: Comment,
		public readonly item: CommonEvaluationItem,
	) {}

	static create(params: {
		id: number;
		sheetId: number;
		itemId: number;
		firstScore?: number;
		secondScore?: number;
		firstComment?: string;
		item: CommonEvaluationItem;
	}): CommonEvaluationResult {
		return new CommonEvaluationResult(
			params.id,
			params.sheetId,
			params.itemId,
			Score.fromOptional(params.firstScore),
			Score.fromOptional(params.secondScore),
			Comment.from(params.firstComment),
			params.item,
		);
	}

	withFirstUpdate(score: number, comment: string): CommonEvaluationResult {
		return new CommonEvaluationResult(
			this.id,
			this.sheetId,
			this.itemId,
			Score.from(score),
			this.secondScore,
			Comment.from(comment),
			this.item,
		);
	}

	withSecondUpdate(score: number): CommonEvaluationResult {
		return new CommonEvaluationResult(
			this.id,
			this.sheetId,
			this.itemId,
			this.firstScore,
			Score.from(score),
			this.firstComment,
			this.item,
		);
	}
}
