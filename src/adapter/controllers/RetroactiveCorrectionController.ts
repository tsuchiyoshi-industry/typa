import {
	type EvaluationPeriodDto,
	toEvaluationPeriodDto,
} from "../../application/dtos/EvaluationPeriodDto";
import {
	type CorrectableSheetDto,
	toCorrectableSheetDto,
} from "../../application/dtos/SheetCorrectionDto";
import { messageOf } from "../../application/errorMessage";
import type {
	CorrectClosedSheetInteractor,
	CorrectClosedSheetRequest,
	CorrectClosedSheetResponse,
} from "../../application/usecases/CorrectClosedSheetInteractor";
import { EvaluationCalendar } from "../../domain/entities/EvaluationCalendar";
import type { EvaluationPeriodRepository } from "../../domain/repositories/EvaluationPeriodRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import type { SheetCorrectionRepository } from "../../domain/repositories/SheetCorrectionRepository";

/** 遡及処理の一覧に出す、締めたシートの1行。 */
export interface ClosedSheetRow {
	sheetId: number;
	employeeName: string;
	employeeNo: string;
	status: string;
}

/** 遡及処理の画面(Admin だけ)。締めた評価期間のシートを選び、項目を直して記録する。 */
export class RetroactiveCorrectionController {
	constructor(
		private readonly periodRepository: Pick<EvaluationPeriodRepository, "findDistinctPeriods">,
		private readonly sheetRepository: Pick<EvaluationSheetRepository, "findOverview">,
		private readonly correctionRepository: Pick<SheetCorrectionRepository, "findClosedSheet">,
		private readonly correctUseCase: CorrectClosedSheetInteractor,
	) {}

	/** 締め済みの評価期間。新しい順。直せるのはこの評価期間のシートだけ。 */
	async closedPeriods(): Promise<EvaluationPeriodDto[]> {
		return new EvaluationCalendar(await this.periodRepository.findDistinctPeriods())
			.all()
			.filter((period) => period.isClosed)
			.map(toEvaluationPeriodDto);
	}

	/** その評価期間のシート。社員番号順。Admin でなければ失敗する。 */
	async sheets(periodId: number): Promise<ClosedSheetRow[]> {
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

	load(sheetId: number): Promise<CorrectableSheetDto> {
		return this.correctionRepository.findClosedSheet(sheetId).then(toCorrectableSheetDto);
	}

	/** confirmed が false なら、直せるかを確かめるだけ(確認ダイアログに出す内容を受け取る)。 */
	async correct(request: CorrectClosedSheetRequest): Promise<CorrectClosedSheetResponse> {
		let response: CorrectClosedSheetResponse = {
			status: "rejected",
			message: "シートを修正できませんでした。",
		};
		try {
			await this.correctUseCase.execute(request, { present: (result) => (response = result) });
		} catch (error) {
			console.error("Error correcting a closed sheet:", error);
			return { status: "rejected", message: messageOf(error, "シートを修正できませんでした。") };
		}
		return response;
	}
}
