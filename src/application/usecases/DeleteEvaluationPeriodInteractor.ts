import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { EvaluationPeriodRepository } from "../../domain/repositories/EvaluationPeriodRepository";
import { canEditSettings } from "../../domain/services/EmployeeMasterAccessService";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";
import type { EvaluationPeriodChangeResponse } from "./SaveEvaluationPeriodInteractor";

export interface DeleteEvaluationPeriodRequest {
	periodId: number;
}

/**
 * 評価期間を削除する。間違えて追加した期間を消すためのもので、実施中の期間と、
 * 評価シートが1枚でもある期間は削除できない(DB側でも拒否する)。
 */
export class DeleteEvaluationPeriodInteractor
	implements UseCase<DeleteEvaluationPeriodRequest, OutputPort<EvaluationPeriodChangeResponse>>
{
	constructor(
		private readonly periodRepository: EvaluationPeriodRepository,
		private readonly employeeMasterRepository: EmployeeMasterRepository,
	) {}

	async execute(
		request: DeleteEvaluationPeriodRequest,
		outputPort: OutputPort<EvaluationPeriodChangeResponse>,
	): Promise<void> {
		const reject = (message: string) => outputPort.present({ success: false, message });

		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee || !canEditSettings(currentEmployee.role)) {
			return reject("評価期間を削除できるのは Admin のみです。");
		}

		const period = await this.periodRepository.findById(request.periodId);
		if (!period) {
			return reject("評価期間が見つかりませんでした。");
		}
		if (period.isActive) {
			return reject("実施中の評価期間は削除できません。");
		}
		const counts = await this.periodRepository.countSheetsByStatus(period.id);
		const sheets = Object.values(counts).reduce((sum, count) => sum + count, 0);
		if (sheets > 0) {
			return reject(
				`「${period.periodName}」には評価シートが ${sheets} 件あるため、削除できません。`,
			);
		}

		if (!(await this.periodRepository.delete(period.id))) {
			return reject("評価期間を削除できませんでした。");
		}
		outputPort.present({
			success: true,
			message: `評価期間「${period.periodName}」を削除しました。`,
		});
	}
}
