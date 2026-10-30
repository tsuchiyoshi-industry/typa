import type { EmployeeRole } from "../valueObjects/EmployeeRole";

/** キャリアコース。役員は評価される側ではない(isExecutive)。 */
export const CAREER_COURSES = ["総合職", "一般職", "技能職", "役員"] as const;

/** 社員番号はログインIDになる。ログイン用の内部アドレスに使えるのは半角英数字・ハイフン・アンダースコアだけ。 */
export const isValidEmployeeNo = (employeeNo: string): boolean =>
	/^[A-Za-z0-9_-]+$/.test(employeeNo);

/**
 * 業務のきまり: 評価者(一次・二次)になれるのは、評価者になれる権限(EmployeeRole.canEvaluate)を持つ人と、
 * 評価する側としてだけ現れる役員。
 */
export const canBeEvaluator = (role: EmployeeRole, careerCourse: string | null): boolean =>
	role.canEvaluate() || isExecutiveCourse(careerCourse);

const isExecutiveCourse = (careerCourse: string | null): boolean => careerCourse?.trim() === "役員";

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
		return isExecutiveCourse(this.careerCourse);
	}

	/** 評価者に選べる人か(canBeEvaluator)。 */
	canBeEvaluator(): boolean {
		return canBeEvaluator(this.role, this.careerCourse);
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
}
