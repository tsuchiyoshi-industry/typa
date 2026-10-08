import type {
	RegisterEmployeeAccountInteractor,
	RegisterEmployeeAccountRequest,
	RegisterEmployeeAccountResponse,
} from "../../application/usecases/RegisterEmployeeAccountInteractor";
import type {
	SignInEmployeeInteractor,
	SignInEmployeeResponse,
} from "../../application/usecases/SignInEmployeeInteractor";
import type { AuthRepository } from "../../domain/repositories/AuthRepository";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import { canEditSettings } from "../../domain/services/EmployeeMasterAccessService";

/** トップバーに出す、ログイン中の社員。 */
export interface CurrentUserDto {
	name: string;
	employeeNo: string;
	role: string;
	canViewSettings: boolean;
}

/** ログイン画面の操作。ログインと登録の手順は use case が持ち、画面は結果に応じた表示だけをする。 */
export class AccountController {
	constructor(
		private readonly signInUseCase: SignInEmployeeInteractor,
		private readonly registerUseCase: RegisterEmployeeAccountInteractor,
		private readonly authRepository: AuthRepository,
		private readonly employeeMasterRepository: EmployeeMasterRepository,
	) {}

	async currentUser(): Promise<CurrentUserDto | null> {
		const person = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		return (
			person && {
				name: person.name,
				employeeNo: person.employeeNo,
				role: person.role.toString(),
				canViewSettings: canEditSettings(person.role),
			}
		);
	}

	async signIn(employeeNo: string, password: string): Promise<SignInEmployeeResponse["status"]> {
		let status: SignInEmployeeResponse["status"] = "invalid_credentials";
		await this.signInUseCase.execute(
			{ employeeNo, password },
			{ present: (response) => (status = response.status) },
		);
		return status;
	}

	async register(
		request: RegisterEmployeeAccountRequest,
	): Promise<RegisterEmployeeAccountResponse["status"]> {
		let status: RegisterEmployeeAccountResponse["status"] = "signup_failed";
		await this.registerUseCase.execute(request, {
			present: (response) => (status = response.status),
		});
		return status;
	}

	/** 新規登録の1歩目。認証コードを送れたか。 */
	async sendVerificationCode(email: string): Promise<boolean> {
		return !(await this.authRepository.sendEmailCode(email)).error;
	}

	signOut(): Promise<void> {
		return this.authRepository.signOut();
	}
}
