import { describePeriodError, type PeriodError } from "../../domain/entities/PeriodError";
import { err, ok, type Result } from "../../domain/Result";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { EvaluationPeriodRepository } from "../../domain/repositories/EvaluationPeriodRepository";
import { canEditSettings } from "../../domain/services/EmployeeMasterAccessService";
import type { OutputPort } from "../ports/OutputPort";
import type { FallibleUseCase } from "../ports/UseCase";
import type { EvaluationPeriodChangeResponse } from "./SaveEvaluationPeriodInteractor";

export interface DeleteEvaluationPeriodRequest {
	periodId: number;
}

export type DeleteEvaluationPeriodError =
	| PeriodError
	| { kind: "forbidden" }
	| { kind: "periodNotFound" }
	| { kind: "deleteFailed" };

export function describeDeleteEvaluationPeriodError(error: DeleteEvaluationPeriodError): string {
	switch (error.kind) {
		case "forbidden":
			return "評価期間を削除できるのは Admin のみです。";
		case "periodNotFound":
			return "評価期間が見つかりませんでした。";
		case "deleteFailed":
			return "評価期間を削除できませんでした。";
		default:
			return describePeriodError(error);
	}
}

/**
 * 評価期間を削除する。間違えて追加した期間を消すためのもので、実施中の期間と、
 * 評価シートが1枚でもある期間は削除できない(DB側でも拒否する)。
 */
export class DeleteEvaluationPeriodInteractor
	implements
		FallibleUseCase<
			DeleteEvaluationPeriodRequest,
			OutputPort<EvaluationPeriodChangeResponse>,
			DeleteEvaluationPeriodError
		>
{
	constructor(
		private readonly periodRepository: EvaluationPeriodRepository,
		private readonly employeeMasterRepository: EmployeeMasterRepository,
	) {}

	async execute(
		request: DeleteEvaluationPeriodRequest,
		outputPort: OutputPort<EvaluationPeriodChangeResponse>,
	): Promise<Result<void, DeleteEvaluationPeriodError>> {
		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee || !canEditSettings(currentEmployee.role)) {
			return err({ kind: "forbidden" });
		}

		const period = await this.periodRepository.findById(request.periodId);
		if (!period) {
			return err({ kind: "periodNotFound" });
		}
		const canDelete = period.deletable(await this.periodRepository.countSheetsByStatus(period.id));
		if (!canDelete.ok) {
			return canDelete;
		}

		if (!(await this.periodRepository.delete(period.id))) {
			return err({ kind: "deleteFailed" });
		}
		outputPort.present({
			success: true,
			message: `評価期間「${period.periodName}」を削除しました。`,
		});
		return ok(undefined);
	}
}
