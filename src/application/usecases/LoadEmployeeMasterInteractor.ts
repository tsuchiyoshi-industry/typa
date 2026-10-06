import type { EmployeeProfile } from "../../domain/entities/EmployeeProfile";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import {
	canEditEvaluators,
	canEditGrades,
	canResetRegistrations,
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
		roleName: profile.roleName,
		careerCourse: profile.careerCourse,
		gradeName: profile.gradeName,
		primaryEvaluatorName: profile.primaryEvaluatorName,
		secondaryEvaluatorName: profile.secondaryEvaluatorName,
	};
}

function toApprovalRelationDto(profile: EmployeeProfile): ApprovalRelationDto {
	return {
		employeeId: profile.id,
		name: profile.name,
		employeeNo: profile.employeeNo,
		careerCourse: profile.careerCourse,
		gradeId: profile.gradeId,
		gradeName: profile.gradeName,
		primaryEvaluatorId: profile.primaryEvaluatorId,
		primaryEvaluatorName: profile.primaryEvaluatorName,
		secondaryEvaluatorId: profile.secondaryEvaluatorId,
		secondaryEvaluatorName: profile.secondaryEvaluatorName,
		noSecondaryEvaluator: profile.noSecondaryEvaluator,
		registered: profile.registered,
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
				canResetRegistrations: false,
				relations: [],
				grades: [],
			});
			return;
		}

		const editableEvaluators = canEditEvaluators(currentEmployee.roleName);
		const editableGrades = canEditGrades(currentEmployee.roleName);
		const relations = editableEvaluators
			? await this.employeeMasterRepository.findAllEmployeeProfiles()
			: [];
		const grades = editableGrades ? await this.employeeMasterRepository.findGrades() : [];

		outputPort.present({
			currentEmployee: toEmployeeProfileDto(currentEmployee),
			mode: resolveEmployeeMasterMode(currentEmployee.roleName),
			canEditEvaluators: editableEvaluators,
			canEditGrades: editableGrades,
			canResetRegistrations: canResetRegistrations(currentEmployee.roleName),
			relations: relations.map(toApprovalRelationDto),
			grades,
		});
	}
}
