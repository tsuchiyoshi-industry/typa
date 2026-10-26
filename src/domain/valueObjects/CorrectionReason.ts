import type { CorrectionError } from "../entities/CorrectionError";
import { err, ok, type Result } from "../Result";

/** 締め後修正の理由。あとから振り返る人が、なぜ直したのかを読めるように必ず残す。 */
export class CorrectionReason {
	static readonly MAX_LENGTH = 500;

	private constructor(private readonly value: string) {}

	static from(value: string): Result<CorrectionReason, CorrectionError> {
		const reason = value.trim();
		return !reason || reason.length > CorrectionReason.MAX_LENGTH
			? err({ kind: "reasonInvalid", max: CorrectionReason.MAX_LENGTH })
			: ok(new CorrectionReason(reason));
	}

	toString(): string {
		return this.value;
	}
}
