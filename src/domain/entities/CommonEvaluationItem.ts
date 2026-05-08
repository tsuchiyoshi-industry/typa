export class CommonEvaluationItem {
	constructor(
		public readonly id: number,
		public readonly title: string,
		public readonly description: string,
		public readonly weight: number,
		public readonly gradeId: number | null,
	) {}

	equals(other: CommonEvaluationItem): boolean {
		return this.id === other.id;
	}
}
