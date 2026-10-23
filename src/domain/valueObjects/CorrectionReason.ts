import { DomainError } from "../DomainError";

/** 締め後修正の理由。あとから振り返る人が、なぜ直したのかを読めるように必ず残す。 */
export class CorrectionReason {
	static readonly MAX_LENGTH = 500;

	private constructor(private readonly value: string) {}

	static from(value: string): CorrectionReason {
		const reason = value.trim();
		if (!reason || reason.length > CorrectionReason.MAX_LENGTH) {
			throw new DomainError(
				`修正の理由を ${CorrectionReason.MAX_LENGTH} 文字以内で入力してください。`,
			);
		}
		return new CorrectionReason(reason);
	}

	toString(): string {
		return this.value;
	}
}
