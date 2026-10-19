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
		/** アプリを閉じた後もログインを残す社員か。共有PCを使う社員は false。 */
		public readonly keepSignedIn = false,
		public readonly enabled = true,
	) {}

	/** 役員は評価される側ではない。等級・評価者は管理せず、権限とログインだけを扱う。 */
	isExecutive(): boolean {
		return this.careerCourse?.trim() === "役員";
	}

	/**
	 * 評価に必要な割り当て(一次・二次評価者、includeGrade なら等級)に未設定があるか。
	 * 二次評価者は「なし」と明示されていれば設定済み。役員には割り当てがない。
	 */
	hasUnsetAssignment(includeGrade: boolean): boolean {
		return (
			!this.isExecutive() &&
			(this.primaryEvaluatorId == null ||
				(this.secondaryEvaluatorId == null && !this.noSecondaryEvaluator) ||
				(includeGrade && this.gradeId == null))
		);
	}

	equals(other: EmployeeProfile): boolean {
		return this.id === other.id;
	}
}
