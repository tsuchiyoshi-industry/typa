import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import { canEditEvaluators, canEditRoles } from "../../domain/services/EmployeeMasterAccessService";
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
		if (!current || !canEditEvaluators(current.role)) {
			throw new Error("マップはReviewer・Adminのみ閲覧できます。");
		}
		const profiles = await this.repository.findAllEmployeeProfiles();
		// 誰がどの権限かは Admin にだけ見せる
		const showRoles = canEditRoles(current.role);
		output.present({
			currentEmployeeId: current.id,
			people: profiles.map((person) => ({
				id: person.id,
				name: person.name,
				employeeNo: person.employeeNo,
				gradeName: person.gradeName,
				careerCourse: person.careerCourse,
				roleName: showRoles ? person.role.toString() : null,
				primaryEvaluatorId: person.primaryEvaluatorId,
				secondaryEvaluatorId: person.secondaryEvaluatorId,
				noSecondaryEvaluator: person.noSecondaryEvaluator,
				registered: person.registered,
			})),
		});
	}
}
