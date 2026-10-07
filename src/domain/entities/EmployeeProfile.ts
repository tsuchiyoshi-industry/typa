import type { EmployeeRole } from "../valueObjects/EmployeeRole";

export class EmployeeProfile {
	constructor(
		public readonly id: number,
		public readonly name: string,
		public readonly employeeNo: string,
		public readonly roleId: number | null,
		public readonly role: EmployeeRole,
		public readonly careerCourse: string | null,
		public readonly gradeId: number | null,
		public readonly gradeName: string,
		public readonly primaryEvaluatorId: number | null,
		public readonly primaryEvaluatorName: string,
		public readonly secondaryEvaluatorId: number | null,
		public readonly secondaryEvaluatorName: string,
		/** 二次評価者を「なし」と明示した社員か。単に未設定(指定待ち)の場合は false。 */
		public readonly noSecondaryEvaluator = false,
		/** 新規登録を済ませ、ログイン用アカウントが紐付いている社員か。 */
		public readonly registered = false,
	) {}

	equals(other: EmployeeProfile): boolean {
		return this.id === other.id;
	}
}
