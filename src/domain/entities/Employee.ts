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
		/** 二次評価者を「なし」と明示した社員か。単に未設定(指定待ち)の場合は false。 */
		public readonly noSecondaryEvaluator = false,
	) {}

	/**
	 * 二次評価者「なし」の社員は、一次評価者が最終評価者を兼ね、一次評価がそのまま最終評価になる。
	 * 二次評価者が未設定なだけの社員は該当しない(設定漏れで一次評価者が最終評価者にならないようにする)。
	 */
	primaryIsFinalEvaluator(): boolean {
		return this.secondaryEvaluatorId === null && this.noSecondaryEvaluator;
	}

	equals(other: Employee): boolean {
		return this.id === other.id;
	}
}
