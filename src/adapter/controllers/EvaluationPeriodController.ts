import type { EvaluationPeriodDto } from "../../application/dtos/EvaluationPeriodDto";
import type {
	CloseEvaluationPeriodInteractor,
	CloseEvaluationPeriodResponse,
} from "../../application/usecases/CloseEvaluationPeriodInteractor";
import type { DeleteEvaluationPeriodInteractor } from "../../application/usecases/DeleteEvaluationPeriodInteractor";
import type {
	EvaluationPeriodChangeResponse,
	SaveEvaluationPeriodInteractor,
	SaveEvaluationPeriodRequest,
} from "../../application/usecases/SaveEvaluationPeriodInteractor";
import type { EvaluationPeriodRepository } from "../../domain/repositories/EvaluationPeriodRepository";

/** 設定画面の「評価期間」。追加・変更・削除と、期間締め。 */
export class EvaluationPeriodController {
	constructor(
		private readonly periodRepository: EvaluationPeriodRepository,
		private readonly saveUseCase: SaveEvaluationPeriodInteractor,
		private readonly deleteUseCase: DeleteEvaluationPeriodInteractor,
		private readonly closeUseCase: CloseEvaluationPeriodInteractor,
	) {}

	/** 新しい期間が上。 */
	async load(): Promise<EvaluationPeriodDto[]> {
		return (await this.periodRepository.findDistinctPeriods())
			.map(({ id, periodName, startDate, endDate, isActive }) => ({
				id,
				periodName,
				startDate,
				endDate,
				isActive,
			}))
			.sort((a, b) => b.startDate.localeCompare(a.startDate));
	}

	async save(request: SaveEvaluationPeriodRequest): Promise<EvaluationPeriodChangeResponse> {
		let response = { success: false, message: "評価期間を保存できませんでした。" };
		try {
			await this.saveUseCase.execute(request, { present: (result) => (response = result) });
		} catch (error) {
			console.error("Error saving evaluation period:", error);
		}
		return response;
	}

	async remove(periodId: number): Promise<EvaluationPeriodChangeResponse> {
		let response = { success: false, message: "評価期間を削除できませんでした。" };
		try {
			await this.deleteUseCase.execute({ periodId }, { present: (result) => (response = result) });
		} catch (error) {
			console.error("Error deleting evaluation period:", error);
		}
		return response;
	}

	/** confirmed が false なら、締められるかを確かめるだけ(確認ダイアログに出す内容を受け取る)。 */
	async close(nextPeriodId: number, confirmed: boolean): Promise<CloseEvaluationPeriodResponse> {
		let response: CloseEvaluationPeriodResponse = {
			status: "rejected",
			message: "評価期間を切り替えられませんでした。",
		};
		try {
			await this.closeUseCase.execute(
				{ nextPeriodId, confirmed },
				{ present: (result) => (response = result) },
			);
		} catch (error) {
			console.error("Error closing evaluation period:", error);
		}
		return response;
	}
}
