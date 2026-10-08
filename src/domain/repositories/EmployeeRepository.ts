import type { Employee } from "../entities/Employee";

export interface EmployeeRepository {
	findCurrentEmployeeId(): Promise<{ data: number | null; error: Error | null }>;
	findById(employeeId: number): Promise<Employee | null>;
	findByEmployeeNo(employeeNo: string): Promise<Employee | null>;
	findSubordinateIds(employeeId: number): Promise<number[]>;
	findEvaluatorNames(
		primaryEvaluatorId: number | null,
		secondaryEvaluatorId: number | null,
		/** true なら二次評価者は「なし」、false なら「未設定」と表示する。 */
		noSecondaryEvaluator?: boolean,
	): Promise<{
		primaryEvaluator: string;
		secondaryEvaluator: string;
	}>;
	findGradeName(gradeId: number | null): Promise<string>;
	/** 新規登録できる社員番号か。missing は社員マスタにない番号、registered は登録済み(紐付け済み)の番号。 */
	findRegistrationStatus(employeeNo: string): Promise<"available" | "registered" | "missing">;
	linkUserToEmployee(employeeNo: string, authUserId: string): Promise<boolean>;
	checkUserLinked(authUserId: string): Promise<boolean>;
}
