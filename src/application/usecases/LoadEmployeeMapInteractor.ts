import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import { canEditEvaluators } from "../../domain/services/EmployeeMasterAccessService";
import type { EmployeeMapDto } from "../dtos/EmployeeMapDto";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export class LoadEmployeeMapInteractor
	implements UseCase<Record<string, never>, OutputPort<EmployeeMapDto>>
{
	constructor(private readonly repository: EmployeeMasterRepository) {}

	async execute(
		_request: Record<string, never>,
		output: OutputPort<EmployeeMapDto>,
	): Promise<void> {
		const current = await this.repository.findCurrentEmployeeProfile();
		if (!current || !canEditEvaluators(current.roleName)) {
			throw new Error("マップはReviewer・Adminのみ閲覧できます。");
		}
		const profiles = await this.repository.findAllEmployeeProfiles();
		output.present({
			currentEmployeeId: current.id,
			people: profiles.map((person) => ({
				id: person.id,
				name: person.name,
				employeeNo: person.employeeNo,
				gradeName: person.gradeName,
				careerCourse: person.careerCourse,
				roleName: person.roleName,
				primaryEvaluatorId: person.primaryEvaluatorId,
				secondaryEvaluatorId: person.secondaryEvaluatorId,
				noSecondaryEvaluator: person.noSecondaryEvaluator,
				registered: person.registered,
			})),
		});
	}
}
