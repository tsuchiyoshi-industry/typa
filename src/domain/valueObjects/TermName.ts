import { DomainError } from "../DomainError";

/** 期(年度)の名前。「26期」のように、Admin が会社の呼び方で付ける。前後の空白は持たない。 */
export class TermName {
	static readonly MAX_LENGTH = 40;

	private constructor(private readonly value: string) {}

	static from(value: string): TermName {
		const name = value.trim();
		if (!name) {
			throw new DomainError("期の名前を入力してください。");
		}
		if (name.length > TermName.MAX_LENGTH) {
			throw new DomainError(`期の名前は ${TermName.MAX_LENGTH} 文字以内で入力してください。`);
		}
		return new TermName(name);
	}

	equals(other: TermName): boolean {
		return this.value === other.value;
	}

	toString(): string {
		return this.value;
	}
}
