import type { EmployeeProfile } from "../../domain/entities/EmployeeProfile";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import {
	canAssignEvaluator,
	canViewAllApprovalRelations,
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
		gradeName: profile.gradeName,
		primaryEvaluatorName: profile.primaryEvaluatorName,
		secondaryEvaluatorName: profile.secondaryEvaluatorName,
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
				canAssignEvaluators: false,
				canViewAllRelations: false,
				relations: [],
			});
			return;
		}

		const mode = resolveEmployeeMasterMode(currentEmployee.roleName);
		const relations =
			mode === "admin"
				? await this.employeeMasterRepository.findAllEmployeeProfiles()
				: mode === "reviewer"
					? await this.employeeMasterRepository.findSubordinateProfiles(currentEmployee.id)
					: [];

		outputPort.present({
			currentEmployee: toEmployeeProfileDto(currentEmployee),
			mode,
			canAssignEvaluators: canAssignEvaluator(currentEmployee.roleName),
			canViewAllRelations: canViewAllApprovalRelations(currentEmployee.roleName),
			relations: relations.map(toApprovalRelationDto),
		});
	}
}
