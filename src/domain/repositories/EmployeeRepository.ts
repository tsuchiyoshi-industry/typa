/**
 * 新規登録を始めた結果。available なら登録でき、token を completeRegistration に渡す。
 * missing は社員マスタにない番号、registered は登録済み(紐付け済み)の番号。
 */
export type RegistrationStart =
	| { status: "available"; token: string }
	| { status: "registered" | "missing" | "invalid_invitation" };

export interface EmployeeRepository {
	findCurrentAccessState(): Promise<"enabled" | "disabled" | "unregistered">;
	findCurrentEmployeeId(): Promise<{ data: number | null; error: Error | null }>;
	findGradeName(gradeId: number | null): Promise<string>;
	/**
	 * 会社のメールアドレスを認証コードで確認したセッションで呼ぶ。確認していなければ reject する。
	 * 確認したメールアドレスは、評価者への通知の宛先として DB が控える。
	 */
	beginRegistration(employeeNo: string, invitationCode?: string): Promise<RegistrationStart>;
	/** 作ったログイン用アカウントのセッションで呼ぶ。社員に紐付いたら true。 */
	completeRegistration(token: string): Promise<boolean>;
	checkUserLinked(authUserId: string): Promise<boolean>;
	/**
	 * 社員マスタで「ログイン状態を保持する」になっている社員か。共有PCを使う社員は false。
	 * 読めなかったときは false(保持しない側)。
	 */
	findKeepSignedIn(authUserId: string): Promise<boolean>;
}
