import type { SheetTransitionError } from "../entities/SheetTransitionError";
import { err, ok, type Result } from "../Result";

/**
 * 目標を差し戻す理由。本人が何を直せばよいか分かるよう、差し戻しには必ず添える。
 * 本人のシートと通知メールにそのまま出る。DB(transition_evaluation_sheet)も同じきまりで断る。
 */
export class GoalReturnReason {
	static readonly MAX_LENGTH = 200;

	private constructor(private readonly value: string) {}

	/** 前後の空白を除いた文字数。絵文字も1文字と数え、DB の char_length とそろえる。 */
	static lengthOf(value: string): number {
		return [...value.trim()].length;
	}

	static from(value: string): Result<GoalReturnReason, SheetTransitionError> {
		const length = GoalReturnReason.lengthOf(value);
		return length === 0 || length > GoalReturnReason.MAX_LENGTH
			? err({ kind: "returnReasonInvalid", max: GoalReturnReason.MAX_LENGTH })
			: ok(new GoalReturnReason(value.trim()));
	}

	toString(): string {
		return this.value;
	}
}
