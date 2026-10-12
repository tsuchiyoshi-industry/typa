/**
 * 新規登録を始めた結果。available なら登録でき、token を completeRegistration に渡す。
 * missing は社員マスタにない番号、registered は登録済み(紐付け済み)の番号。
 */
export type RegistrationStart =
	| { status: "available"; token: string }
	| { status: "registered" | "missing" };

export interface EmployeeRepository {
	findCurrentEmployeeId(): Promise<{ data: number | null; error: Error | null }>;
	findGradeName(gradeId: number | null): Promise<string>;
	/**
	 * 会社のメールアドレスを認証コードで確認したセッションで呼ぶ。確認していなければ reject する。
	 * 確認したメールアドレスは、評価者への通知の宛先として DB が控える。
	 */
	beginRegistration(employeeNo: string): Promise<RegistrationStart>;
	/** 作ったログイン用アカウントのセッションで呼ぶ。社員に紐付いたら true。 */
	completeRegistration(token: string): Promise<boolean>;
	checkUserLinked(authUserId: string): Promise<boolean>;
}
