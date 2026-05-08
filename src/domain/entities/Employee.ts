export class Employee {
	constructor(
		public readonly id: number,
		public readonly name: string,
		public readonly employeeNo: string,
		public readonly roleId: number,
		public readonly careerCourse: string | null,
		public readonly gradeId: number | null,
		public readonly primaryEvaluatorId: number | null,
		public readonly secondaryEvaluatorId: number | null,
	) {}

	equals(other: Employee): boolean {
		return this.id === other.id;
	}
}
