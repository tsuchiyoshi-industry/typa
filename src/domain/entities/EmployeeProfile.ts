export type EmployeeRoleName = "Admin" | "Reviewer" | "Employee" | string;

export class EmployeeProfile {
	constructor(
		public readonly id: number,
		public readonly name: string,
		public readonly employeeNo: string,
		public readonly roleId: number | null,
		public readonly roleName: EmployeeRoleName,
		public readonly careerCourse: string | null,
		public readonly gradeId: number | null,
		public readonly gradeName: string,
		public readonly primaryEvaluatorId: number | null,
		public readonly primaryEvaluatorName: string,
		public readonly secondaryEvaluatorId: number | null,
		public readonly secondaryEvaluatorName: string,
	) {}

	equals(other: EmployeeProfile): boolean {
		return this.id === other.id;
	}
}
