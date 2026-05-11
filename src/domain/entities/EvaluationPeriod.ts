export class EvaluationPeriod {
	constructor(
		public readonly id: number,
		public readonly periodName: string,
		public readonly startDate: string,
		public readonly endDate: string,
		public readonly isActive: boolean,
	) {}

	equals(other: EvaluationPeriod): boolean {
		return this.id === other.id;
	}
}
