export const EMPLOYEE_ROLE_NAMES = ["Admin", "Reviewer", "Employee"] as const;
export type EmployeeRoleName = (typeof EMPLOYEE_ROLE_NAMES)[number];

/**
 * TYPA の権限。DB には名前(文字列)で保存するが、アプリの中ではこの3つ以外の値を持ち回らない。
 * 権限を増やすときはここに足す。権限ごとの分岐は Record<EmployeeRoleName, …> で書いてあり、
 * 足した権限の扱いを決めていない箇所はコンパイルエラーになる。
 */
export class EmployeeRole {
	private constructor(private readonly value: EmployeeRoleName) {}

	static readonly ADMIN = new EmployeeRole("Admin");
	static readonly REVIEWER = new EmployeeRole("Reviewer");
	static readonly EMPLOYEE = new EmployeeRole("Employee");
	static readonly ALL: readonly EmployeeRole[] = [
		EmployeeRole.ADMIN,
		EmployeeRole.REVIEWER,
		EmployeeRole.EMPLOYEE,
	];

	/** 画面などから来た名前を権限にする。知らない名前は undefined。 */
	static find(value?: string | null): EmployeeRole | undefined {
		return EmployeeRole.ALL.find((role) => role.value === value);
	}

	/** DB の値から復元する。未設定や、このアプリが知らない名前は、いちばん弱い Employee として扱う。 */
	static fromStored(value?: string | null): EmployeeRole {
		return EmployeeRole.find(value) ?? EmployeeRole.EMPLOYEE;
	}

	isAdmin(): boolean {
		return this.value === "Admin";
	}

	toString(): EmployeeRoleName {
		return this.value;
	}

	equals(other: EmployeeRole): boolean {
		return this.value === other.value;
	}
}
