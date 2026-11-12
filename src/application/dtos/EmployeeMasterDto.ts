import type {
	EmployeeGrade,
	EvaluatorType,
} from "../../domain/repositories/EmployeeMasterRepository";
import type { EmployeeMasterMode } from "../../domain/services/EmployeeMasterAccessService";

export interface EmployeeProfileDto {
	id: number;
	name: string;
	employeeNo: string;
	roleName: string;
	careerCourse: string | null;
	gradeName: string;
	primaryEvaluatorName: string;
	secondaryEvaluatorName: string;
}

export interface ApprovalRelationDto {
	employeeId: number;
	name: string;
	employeeNo: string;
	careerCourse: string | null;
	/**
	 * 見る人を限る項目(ドメインの canViewEmployeeDetail)は、見られないとき null。
	 * 権限・ログイン状態の保持・登録・利用状態は Admin と本人、等級は Admin・Reviewer と本人だけ。
	 */
	roleName: string | null;
	gradeId: number | null;
	gradeName: string | null;
	primaryEvaluatorId: number | null;
	primaryEvaluatorName: string;
	secondaryEvaluatorId: number | null;
	secondaryEvaluatorName: string;
	/** 二次評価者を「なし」と明示しているか。false で secondaryEvaluatorId が null なら未設定(指定待ち)。 */
	noSecondaryEvaluator: boolean;
	/** 役員。等級・評価者の管理対象外で、評価の流れには評価する側としてだけ現れる。 */
	isExecutive: boolean;
	/** 見ている人が埋められる割り当て(評価者、等級を変えられる人には等級も)に未設定があるか。 */
	hasUnsetAssignment: boolean;
	/** 新規登録を済ませているか。登録の取り消しは登録済みの社員にだけ行える。 */
	registered: boolean | null;
	enabled: boolean | null;
	/** アプリを閉じた後もログインを残すか。 */
	keepSignedIn: boolean | null;
}

export interface EmployeeMasterDto {
	currentEmployee: EmployeeProfileDto | null;
	mode: EmployeeMasterMode;
	canEditEvaluators: boolean;
	canEditGrades: boolean;
	canEditRoles: boolean;
	canResetRegistrations: boolean;
	relations: ApprovalRelationDto[];
	grades: EmployeeGrade[];
}

export interface AssignEvaluatorResultDto {
	success: boolean;
	message: string;
	evaluatorType: EvaluatorType;
	targetEmployeeNo: string;
}
