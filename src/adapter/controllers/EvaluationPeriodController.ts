import {
	type EvaluationPeriodDto,
	toEvaluationPeriodDto,
} from "../../application/dtos/EvaluationPeriodDto";
import type {
	CloseEvaluationPeriodInteractor,
	CloseEvaluationPeriodResponse,
} from "../../application/usecases/CloseEvaluationPeriodInteractor";
import type { DeleteEvaluationPeriodInteractor } from "../../application/usecases/DeleteEvaluationPeriodInteractor";
import {
	type EvaluationPeriodChangeResponse,
	planNewPeriods,
	type SaveEvaluationPeriodInteractor,
	type SaveEvaluationPeriodRequest,
} from "../../application/usecases/SaveEvaluationPeriodInteractor";
import { DomainError } from "../../domain/DomainError";
import { EvaluationCalendar } from "../../domain/entities/EvaluationCalendar";
import type { EvaluationPeriodRepository } from "../../domain/repositories/EvaluationPeriodRepository";
import { PeriodDivision } from "../../domain/valueObjects/PeriodDivision";

/** 追加する前に見せる、分けた評価期間。 */
export type EvaluationPeriodPreview =
	| { periods: { periodName: string; startDate: string; endDate: string }[] }
	| { error: string };

/** 設定画面の「評価期間」。追加・変更・削除と、期間締め。 */
export class EvaluationPeriodController {
	constructor(
		private readonly periodRepository: EvaluationPeriodRepository,
		private readonly saveUseCase: SaveEvaluationPeriodInteractor,
		private readonly deleteUseCase: DeleteEvaluationPeriodInteractor,
		private readonly closeUseCase: CloseEvaluationPeriodInteractor,
	) {}

	/** 区切り方の選択肢。 */
	readonly divisions = PeriodDivision.ALL.map((division) => ({
		value: division.toString(),
		label: division.label,
	}));

	/** 新しい評価期間が上。 */
	async load(): Promise<EvaluationPeriodDto[]> {
		return new EvaluationCalendar(await this.periodRepository.findDistinctPeriods())
			.all()
			.map(toEvaluationPeriodDto);
	}

	/** 追加する評価期間を、保存せずに計算する。入力が足りない・誤っているときは、その理由。 */
	preview(request: Omit<SaveEvaluationPeriodRequest, "periodId">): EvaluationPeriodPreview {
		try {
			return {
				periods: planNewPeriods(request).map((plan) => ({
					periodName: plan.periodName,
					startDate: plan.range.start.toString(),
					endDate: plan.range.end.toString(),
				})),
			};
		} catch (error) {
			if (error instanceof DomainError) {
				return { error: error.message };
			}
			throw error;
		}
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
