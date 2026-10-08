import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";

/** ログイン中の社員ID。取れなければ、その理由を presentError に渡して null を返す。 */
export async function requireCurrentEmployeeId(
	employeeRepository: EmployeeRepository,
	presentError: (message: string) => void,
): Promise<number | null> {
	const { data, error } = await employeeRepository.findCurrentEmployeeId();
	if (error || data === null) {
		presentError(error ? `認証エラー: ${error.message}` : "ログインが必要です。");
		return null;
	}
	return data;
}
