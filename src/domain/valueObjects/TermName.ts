import type { PeriodError } from "../entities/PeriodError";
import { err, ok, type Result } from "../Result";

/** 期(年度)の名前。「26期」のように、Admin が会社の呼び方で付ける。前後の空白は持たない。 */
export class TermName {
	static readonly MAX_LENGTH = 40;

	private constructor(private readonly value: string) {}

	static from(value: string): Result<TermName, PeriodError> {
		const name = value.trim();
		if (!name) {
			return err({ kind: "termNameMissing" });
		}
		if (name.length > TermName.MAX_LENGTH) {
			return err({ kind: "termNameTooLong", max: TermName.MAX_LENGTH });
		}
		return ok(new TermName(name));
	}

	equals(other: TermName): boolean {
		return this.value === other.value;
	}

	toString(): string {
		return this.value;
	}
}
