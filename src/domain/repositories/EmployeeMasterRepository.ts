import type { EmployeeProfile } from "../entities/EmployeeProfile";

export type EvaluatorType = "primary" | "secondary";

export interface EmployeeGrade {
	id: number;
	name: string;
}

export interface EmployeeMasterRepository {
	findCurrentEmployeeProfile(): Promise<EmployeeProfile | null>;
	findAllEmployeeProfiles(): Promise<EmployeeProfile[]>;
	findByEmployeeNo(employeeNo: string): Promise<EmployeeProfile | null>;
	findGrades(): Promise<EmployeeGrade[]>;
	/** evaluatorEmployeeNo が null の場合は、二次評価者を「なし」と明示して保存する(未設定とは区別する)。 */
	updateEvaluatorByEmployeeNo(
		targetEmployeeNo: string,
		evaluatorEmployeeNo: string | null,
		evaluatorType: EvaluatorType,
	): Promise<EmployeeProfile | null>;
	updateGradeByEmployeeNo(
		targetEmployeeNo: string,
		gradeId: number,
	): Promise<EmployeeProfile | null>;
	/**
	 * 社員の行は残したまま、ログイン用アカウントを削除して未登録に戻す(評価データは残る)。
	 * 取り消せたら true。
	 */
	resetRegistrationByEmployeeNo(targetEmployeeNo: string): Promise<boolean>;
}
