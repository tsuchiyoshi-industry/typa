import { CAREER_COURSES, isValidEmployeeNo } from "../../domain/entities/EmployeeProfile";
import type {
	EmployeeMasterRepository,
	NewEmployee,
} from "../../domain/repositories/EmployeeMasterRepository";
import { canRunSetup } from "../../domain/services/EmployeeMasterAccessService";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export type PreRegisterEmployeeRequest = NewEmployee;

export interface PreRegisterEmployeeResponse {
	success: boolean;
	message: string;
}

export interface PreRegisterEmployeeOutputPort extends OutputPort<PreRegisterEmployeeResponse> {}

/**
 * 導入処理の「初期ユーザ」: ログイン用アカウントのない社員を社員マスタに足す。
 * 本人はこの後、Admin が発行した招待コードで新規登録する。同じ確認は DB 関数でも行う。
 */
export class PreRegisterEmployeeInteractor
	implements UseCase<PreRegisterEmployeeRequest, PreRegisterEmployeeOutputPort>
{
	constructor(private readonly employeeMasterRepository: EmployeeMasterRepository) {}

	async execute(
		request: PreRegisterEmployeeRequest,
		outputPort: PreRegisterEmployeeOutputPort,
	): Promise<void> {
		const fail = (message: string) => outputPort.present({ success: false, message });

		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee || !canRunSetup(currentEmployee.role)) {
			fail("社員を仮登録する権限がありません。");
			return;
		}

		// 全角で打った数字・英字も、ログインに使える半角にそろえる
		const employeeNo = request.employeeNo.normalize("NFKC").trim();
		const name = request.name.trim();
		if (!isValidEmployeeNo(employeeNo)) {
			fail("社員番号は半角英数字・ハイフン・アンダースコアで入力してください。");
			return;
		}
		if (!name) {
			fail("氏名を入力してください。");
			return;
		}
		if (!(CAREER_COURSES as readonly string[]).includes(request.careerCourse)) {
			fail("キャリアコースを選んでください。");
			return;
		}
		if (request.secondaryEvaluatorEmployeeNo !== null && request.noSecondaryEvaluator) {
			fail("二次評価者と「なし」は同時に指定できません。");
			return;
		}

		const [grades, employees] = await Promise.all([
			this.employeeMasterRepository.findGrades(),
			this.employeeMasterRepository.findAllEmployeeProfiles(),
		]);
		if (!grades.some((grade) => grade.id === request.gradeId)) {
			fail("等級を選んでください。");
			return;
		}
		// ログインIDは小文字にそろえて扱うので、大文字・小文字だけが違う番号も同じ人とみなす
		const taken = employees.find(
			(employee) => employee.employeeNo.toLowerCase() === employeeNo.toLowerCase(),
		);
		if (taken) {
			fail(`社員番号 ${taken.employeeNo} は${taken.name}さんが使っています。`);
			return;
		}
		const exists = (evaluatorNo: string | null) =>
			evaluatorNo === null || employees.some((employee) => employee.employeeNo === evaluatorNo);
		if (
			!exists(request.primaryEvaluatorEmployeeNo) ||
			!exists(request.secondaryEvaluatorEmployeeNo)
		) {
			fail("評価者が見つかりませんでした。");
			return;
		}
		const ineligible = employees.find(
			(employee) =>
				(employee.employeeNo === request.primaryEvaluatorEmployeeNo ||
					employee.employeeNo === request.secondaryEvaluatorEmployeeNo) &&
				!employee.canBeEvaluator(),
		);
		if (ineligible) {
			fail(`${ineligible.name}さんは評価者の権限を持っていないため、評価者に設定できません。`);
			return;
		}

		const registered = await this.employeeMasterRepository.preRegisterEmployee({
			...request,
			employeeNo,
			name,
		});
		outputPort.present(
			registered
				? {
						success: true,
						message: `${name}さん(${employeeNo})を仮登録しました。社員マスタで招待コードを発行してください。`,
					}
				: { success: false, message: "仮登録できませんでした。" },
		);
	}
}
