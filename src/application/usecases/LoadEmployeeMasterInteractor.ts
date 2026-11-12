import type { EmployeeProfile } from "../../domain/entities/EmployeeProfile";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import {
	canEditEvaluators,
	canEditGrades,
	canEditRoles,
	canResetRegistrations,
	canViewAllEmployees,
	canViewEmployeeDetail,
	resolveEmployeeMasterMode,
} from "../../domain/services/EmployeeMasterAccessService";
import type {
	ApprovalRelationDto,
	EmployeeMasterDto,
	EmployeeProfileDto,
} from "../dtos/EmployeeMasterDto";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export type LoadEmployeeMasterRequest = Record<string, never>;

export interface LoadEmployeeMasterResponse extends EmployeeMasterDto {}

export interface LoadEmployeeMasterOutputPort extends OutputPort<LoadEmployeeMasterResponse> {}

function toEmployeeProfileDto(profile: EmployeeProfile): EmployeeProfileDto {
	return {
		id: profile.id,
		name: profile.name,
		employeeNo: profile.employeeNo,
		roleName: profile.role.toString(),
		careerCourse: profile.careerCourse,
		gradeName: profile.gradeName,
		primaryEvaluatorName: profile.primaryEvaluatorName,
		secondaryEvaluatorName: profile.secondaryEvaluatorName,
	};
}

/**
 * 一覧の社員を、見る人(viewer)が見てよい項目だけにする(ドメインの canViewEmployeeDetail)。
 * includeGrade: 見ている人が等級を変えられるか。変えられない項目は未設定として数えない。
 */
function toApprovalRelationDto(
	profile: EmployeeProfile,
	viewer: EmployeeProfile,
	includeGrade: boolean,
): ApprovalRelationDto {
	const sees = (detail: Parameters<typeof canViewEmployeeDetail>[1]) =>
		canViewEmployeeDetail(viewer.role, detail, profile.id === viewer.id);
	return {
		employeeId: profile.id,
		name: profile.name,
		employeeNo: profile.employeeNo,
		careerCourse: profile.careerCourse,
		roleName: sees("role") ? profile.role.toString() : null,
		gradeId: sees("grade") ? profile.gradeId : null,
		gradeName: sees("grade") ? profile.gradeName : null,
		primaryEvaluatorId: profile.primaryEvaluatorId,
		primaryEvaluatorName: profile.primaryEvaluatorName,
		secondaryEvaluatorId: profile.secondaryEvaluatorId,
		secondaryEvaluatorName: profile.secondaryEvaluatorName,
		noSecondaryEvaluator: profile.noSecondaryEvaluator,
		isExecutive: profile.isExecutive(),
		hasUnsetAssignment: profile.hasUnsetAssignment(includeGrade),
		registered: sees("account") ? profile.registered : null,
		enabled: sees("account") ? profile.enabled : null,
		keepSignedIn: sees("keepSignedIn") ? profile.keepSignedIn : null,
	};
}

export class LoadEmployeeMasterInteractor
	implements UseCase<LoadEmployeeMasterRequest, LoadEmployeeMasterOutputPort>
{
	constructor(private readonly employeeMasterRepository: EmployeeMasterRepository) {}

	async execute(
		_request: LoadEmployeeMasterRequest,
		outputPort: LoadEmployeeMasterOutputPort,
	): Promise<void> {
		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee) {
			outputPort.present({
				currentEmployee: null,
				mode: "employee",
				canEditEvaluators: false,
				canEditGrades: false,
				canEditRoles: false,
				canResetRegistrations: false,
				relations: [],
				grades: [],
			});
			return;
		}

		const editableEvaluators = canEditEvaluators(currentEmployee.role);
		const editableGrades = canEditGrades(currentEmployee.role);
		const editableRoles = canEditRoles(currentEmployee.role);
		// 全社員を見られない人には、一覧を出さない(自分のプロフィールだけ)
		const relations = canViewAllEmployees(currentEmployee.role)
			? await this.employeeMasterRepository.findAllEmployeeProfiles()
			: [];
		const grades = editableGrades ? await this.employeeMasterRepository.findGrades() : [];

		outputPort.present({
			currentEmployee: toEmployeeProfileDto(currentEmployee),
			mode: resolveEmployeeMasterMode(currentEmployee.role),
			canEditEvaluators: editableEvaluators,
			canEditGrades: editableGrades,
			canEditRoles: editableRoles,
			canResetRegistrations: canResetRegistrations(currentEmployee.role),
			relations: relations.map((profile) =>
				toApprovalRelationDto(profile, currentEmployee, editableGrades),
			),
			grades,
		});
	}
}
