import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import {
	isPrimaryEvaluator,
	isSecondaryEvaluator,
} from "../../domain/services/EvaluatorRoleService";
import type { EmployeeDto } from "../dtos/EmployeeDto";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface CheckEvaluatorRoleRequest {
	subject: EmployeeDto | null;
}

export interface CheckEvaluatorRoleResponse {
	canEditFirst: boolean;
	canEditSecond: boolean;
}

export interface CheckEvaluatorRoleOutputPort extends OutputPort<CheckEvaluatorRoleResponse> {}

export class CheckEvaluatorRoleInteractor
	implements UseCase<CheckEvaluatorRoleRequest, CheckEvaluatorRoleOutputPort>
{
	constructor(private readonly employeeRepository: EmployeeRepository) {}

	async execute(
		request: CheckEvaluatorRoleRequest,
		outputPort: CheckEvaluatorRoleOutputPort,
	): Promise<void> {
		const currentEmployeeId = await this.employeeRepository.findCurrentEmployeeId();
		const canEditFirst = request.subject
			? isPrimaryEvaluator(currentEmployeeId, {
					id: request.subject.id,
					name: request.subject.name,
					employeeNo: request.subject.employeeNo,
					roleId: request.subject.roleId,
					careerCourse: request.subject.careerCourse,
					gradeId: request.subject.gradeId,
					primaryEvaluatorId: request.subject.primaryEvaluatorId,
					secondaryEvaluatorId: request.subject.secondaryEvaluatorId,
				})
			: false;
		const canEditSecond = request.subject
			? isSecondaryEvaluator(currentEmployeeId, {
					id: request.subject.id,
					name: request.subject.name,
					employeeNo: request.subject.employeeNo,
					roleId: request.subject.roleId,
					careerCourse: request.subject.careerCourse,
					gradeId: request.subject.gradeId,
					primaryEvaluatorId: request.subject.primaryEvaluatorId,
					secondaryEvaluatorId: request.subject.secondaryEvaluatorId,
				})
			: false;

		outputPort.present({ canEditFirst, canEditSecond });
	}
}
