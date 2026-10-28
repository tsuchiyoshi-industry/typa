import {
	type EvaluationPeriodDto,
	toEvaluationPeriodDto,
} from "../../application/dtos/EvaluationPeriodDto";
import {
	type CorrectableSheetDto,
	toCorrectableSheetDto,
} from "../../application/dtos/SheetCorrectionDto";
import { messageOf } from "../../application/errorMessage";
import {
	type ChangeSheetGradeInteractor,
	describeSheetGradeChangeError,
} from "../../application/usecases/ChangeSheetGradeInteractor";
import type {
	CorrectClosedSheetInteractor,
	CorrectClosedSheetRequest,
	CorrectClosedSheetResponse,
} from "../../application/usecases/CorrectClosedSheetInteractor";
import { describeCorrectClosedSheetError } from "../../application/usecases/CorrectClosedSheetInteractor";
import {
	describePrivilegedSheetOperationError,
	type PrivilegedSheetOperationInteractor,
} from "../../application/usecases/PrivilegedSheetOperationInteractor";
import { EvaluationCalendar } from "../../domain/entities/EvaluationCalendar";
import type { PrivilegedSheetOperationRequest } from "../../domain/entities/PrivilegedSheetOperation";
import type { SheetGradeChangeRequest } from "../../domain/entities/SheetGradeChange";
import type {
	EmployeeGrade,
	EmployeeMasterRepository,
} from "../../domain/repositories/EmployeeMasterRepository";
import type { EvaluationPeriodRepository } from "../../domain/repositories/EvaluationPeriodRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import type { SheetCorrectionRepository } from "../../domain/repositories/SheetCorrectionRepository";
import { canCorrectClosedSheets } from "../../domain/services/EmployeeMasterAccessService";
import type { EvaluationStatusValue } from "../../domain/valueObjects/EvaluationStatus";

/** 一覧に出すシートの1行。 */
export interface MaintainedSheetRow {
	sheetId: number;
	employeeName: string;
	employeeNo: string;
	status: EvaluationStatusValue;
	/** シートを作成したときの等級。未設定なら null と空文字。 */
	gradeId: number | null;
	gradeName: string;
}

/**
 * 遡及処理の画面(Admin だけ)。シートを選び、値を直す(締め済みの期間だけ)・状態を変える・削除する。
 * 当期のシートは作成時の等級も変えられる(共通評価の入力は消える)。
 * 値の修正は締め後修正として本人と評価者に見え、状態変更・削除・等級の変更は通知なしで監査ログに残る。
 */
export class RetroactiveCorrectionController {
	constructor(
		private readonly employees: Pick<
			EmployeeMasterRepository,
			"findCurrentEmployeeProfile" | "findGrades"
		>,
		private readonly periodRepository: Pick<EvaluationPeriodRepository, "findDistinctPeriods">,
		private readonly sheetRepository: Pick<EvaluationSheetRepository, "findOverview">,
		private readonly correctionRepository: Pick<SheetCorrectionRepository, "findClosedSheet">,
		private readonly correctUseCase: CorrectClosedSheetInteractor,
		private readonly operationUseCase: PrivilegedSheetOperationInteractor,
		private readonly gradeUseCase: ChangeSheetGradeInteractor,
	) {}

	/** すべての評価期間。新しい順。Admin でなければ何も読まずに断る(URL を直接開いたときも)。 */
	async periods(): Promise<EvaluationPeriodDto[]> {
		const actor = await this.employees.findCurrentEmployeeProfile();
		if (!actor?.enabled || !canCorrectClosedSheets(actor.role)) {
			throw new Error("遡及処理は Admin のみ利用できます。");
		}
		return new EvaluationCalendar(await this.periodRepository.findDistinctPeriods())
			.all()
			.map(toEvaluationPeriodDto);
	}

	/** その評価期間のシート。社員番号順。 */
	async sheets(periodId: number): Promise<MaintainedSheetRow[]> {
		return (await this.sheetRepository.findOverview())
			.filter((row) => row.periodId === periodId)
			.map((row) => ({
				sheetId: row.id,
				employeeName: row.employeeName,
				employeeNo: row.employeeNo,
				status: row.status.toString(),
				gradeId: row.gradeId ?? null,
				gradeName: row.gradeName,
			}))
			.sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));
	}

	/** 値を直すためにシートの中身を読む。締め済みの期間のシートだけ(DB も同じ条件で断る)。 */
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
			const result = await this.correctUseCase.execute(request, {
				present: (value) => (response = value),
			});
			if (!result.ok) {
				return {
					status: "rejected",
					message: describeCorrectClosedSheetError(result.error),
				};
			}
		} catch (error) {
			console.error("Error correcting a closed sheet:", error);
			return { status: "rejected", message: messageOf(error, "シートを修正できませんでした。") };
		}
		return response;
	}

	/** 状態を変える・削除する。通常の進行条件を越え、どの期間のシートにも行える。 */
	async operate(
		request: PrivilegedSheetOperationRequest,
	): Promise<{ success: boolean; message: string }> {
		let message = "操作を完了できませんでした。";
		try {
			const result = await this.operationUseCase.execute(request, {
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

	/** 変更後の等級の選択肢。 */
	grades(): Promise<EmployeeGrade[]> {
		return this.employees.findGrades();
	}

	/** 当期のシートの作成時の等級を変える。共通評価の入力は消え、取り消せない。 */
	async changeGrade(
		request: SheetGradeChangeRequest,
	): Promise<{ success: boolean; message: string }> {
		let message = "等級を変更しました。";
		try {
			const result = await this.gradeUseCase.execute(request, {
				present: (value) => {
					message = value.message;
				},
			});
			return result.ok
				? { success: true, message }
				: { success: false, message: describeSheetGradeChangeError(result.error) };
		} catch (error) {
			return { success: false, message: messageOf(error, "等級を変更できませんでした。") };
		}
	}
}
