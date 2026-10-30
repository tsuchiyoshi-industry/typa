export class Comment {
	private constructor(public readonly value: string) {}

	static from(value: string | null | undefined): Comment {
		return new Comment(value?.trim() ?? "");
	}

	toString(): string {
		return this.value;
	}
}
