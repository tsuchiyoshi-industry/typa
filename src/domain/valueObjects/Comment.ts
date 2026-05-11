export class Comment {
	private constructor(public readonly value: string) {}

	static from(value: string | null | undefined): Comment {
		return new Comment(value?.trim() ?? "");
	}

	equals(other: Comment): boolean {
		return this.value === other.value;
	}

	toString(): string {
		return this.value;
	}
}
