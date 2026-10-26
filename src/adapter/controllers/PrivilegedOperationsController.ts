import { toEvaluationPeriodDto } from "../../application/dtos/EvaluationPeriodDto";
import { messageOf } from "../../application/errorMessage";
import {
	describePrivilegedSheetOperationError,
	type PrivilegedSheetOperationInteractor,
} from "../../application/usecases/PrivilegedSheetOperationInteractor";
import type { PrivilegedSheetOperationRequest } from "../../domain/entities/PrivilegedSheetOperation";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { EvaluationPeriodRepository } from "../../domain/repositories/EvaluationPeriodRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import { canRunPrivilegedOperations } from "../../domain/services/EmployeeMasterAccessService";
import type { EvaluationStatusValue } from "../../domain/valueObjects/EvaluationStatus";

export interface PrivilegedSheetRow {
	sheetId: number;
	employeeName: string;
	employeeNo: string;
	status: EvaluationStatusValue;
}

export class PrivilegedOperationsController {
	constructor(
		private readonly employees: Pick<EmployeeMasterRepository, "findCurrentEmployeeProfile">,
		private readonly periodRepository: Pick<EvaluationPeriodRepository, "findDistinctPeriods">,
		private readonly sheetRepository: Pick<EvaluationSheetRepository, "findOverview">,
		private readonly usecase: PrivilegedSheetOperationInteractor,
	) {}

	async periods() {
		const actor = await this.employees.findCurrentEmployeeProfile();
		if (!actor?.enabled || !canRunPrivilegedOperations(actor.role)) {
			throw new Error("特権操作は Admin のみ利用できます。");
		}
		return (await this.periodRepository.findDistinctPeriods())
			.sort((a, b) => b.startDate.localeCompare(a.startDate))
			.map(toEvaluationPeriodDto);
	}

	async sheets(periodId: number): Promise<PrivilegedSheetRow[]> {
		return (await this.sheetRepository.findOverview())
			.filter((row) => row.periodId === periodId)
			.map((row) => ({
				sheetId: row.id,
				employeeName: row.employeeName,
				employeeNo: row.employeeNo,
				status: row.status.toString(),
			}))
			.sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));
	}

	async execute(
		request: PrivilegedSheetOperationRequest,
	): Promise<{ success: boolean; message: string }> {
		let message = "操作を完了できませんでした。";
		try {
			const result = await this.usecase.execute(request, {
				present: (value) => {
					message = value.message;
				},
			});
			return result.ok
				? { success: true, message }
				: { success: false, message: describePrivilegedSheetOperationError(result.error) };
		} catch (error) {
			return { success: false, message: messageOf(error, "操作を完了できませんでした。") };
		}
	}
}
