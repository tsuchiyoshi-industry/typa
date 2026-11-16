import {
	type SheetImportPeriodDto,
	toSheetImportPeriodDto,
} from "../../application/dtos/SheetImportPeriodDto";
import { messageOf } from "../../application/errorMessage";
import type { CsvFileGateway } from "../../application/ports/CsvFileGateway";
import type { ImportSheetDataInteractor } from "../../application/usecases/ImportSheetDataInteractor";
import { buildTemplate } from "../../application/usecases/sheetImportCsv";
import { EvaluationCalendar } from "../../domain/entities/EvaluationCalendar";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { EvaluationPeriodRepository } from "../../domain/repositories/EvaluationPeriodRepository";
import type {
	SheetImportFile,
	SheetImportRepository,
	SheetImportResult,
	SheetImportTemplate,
} from "../../domain/repositories/SheetImportRepository";
import { canRunSetup } from "../../domain/services/EmployeeMasterAccessService";

export interface SheetImportRun {
	periodId: number;
	/** 締め済みの評価期間に書くことを、確認のダイアログで確かめたか。 */
	closedPeriodConfirmed: boolean;
	goals: File | null;
	common: File | null;
	apply: boolean;
}

/** 導入処理の「データ取込」画面の操作。 */
export class SheetImportController {
	constructor(
		private readonly employees: Pick<EmployeeMasterRepository, "findCurrentEmployeeProfile">,
		private readonly periodRepository: Pick<EvaluationPeriodRepository, "findDistinctPeriods">,
		private readonly repository: Pick<SheetImportRepository, "findTemplate">,
		private readonly importUseCase: ImportSheetDataInteractor,
		private readonly csvGateway: CsvFileGateway,
	) {}

	/**
	 * 取り込める評価期間(実施中と締め済み)。新しい順。
	 * Admin でなければ何も読まずに断る(URL を直接開いたときも)。DB 関数も Admin 以外を断る。
	 */
	async periods(): Promise<SheetImportPeriodDto[]> {
		const actor = await this.employees.findCurrentEmployeeProfile();
		if (!actor?.enabled || !canRunSetup(actor.role)) {
			throw new Error("データ取込は Admin のみ利用できます。");
		}
		return new EvaluationCalendar(await this.periodRepository.findDistinctPeriods())
			.importTargets()
			.map(toSheetImportPeriodDto);
	}

	/** 選んだ評価期間のテンプレート。取り込めない評価期間なら、その理由を投げる。 */
	loadTemplate(periodId: number): Promise<SheetImportTemplate> {
		return this.repository.findTemplate(periodId);
	}

	/** 保存したパス。保存ダイアログを取り消したら null。 */
	async saveTemplate(file: SheetImportFile, template: SheetImportTemplate): Promise<string | null> {
		const name = `${template.periodName}_${file === "goals" ? "目標" : "共通評価"}.csv`;
		const path = await this.csvGateway.selectDestination(name.replace(/[\\/:*?"<>|]/g, "_"));
		if (path) {
			await this.csvGateway.save(buildTemplate(file, template), path);
		}
		return path;
	}

	async run(request: SheetImportRun): Promise<SheetImportResult> {
		let result: SheetImportResult | null = null;
		try {
			await this.importUseCase.execute(
				{
					periodId: request.periodId,
					closedPeriodConfirmed: request.closedPeriodConfirmed,
					goals: request.goals && (await request.goals.arrayBuffer()),
					common: request.common && (await request.common.arrayBuffer()),
					apply: request.apply,
				},
				{ present: (response) => (result = response) },
			);
		} catch (error) {
			console.error("Error importing sheet data:", error);
			return {
				errors: [{ file: null, line: null, message: messageOf(error, "取り込めませんでした。") }],
				summary: null,
				applied: false,
			};
		}
		return result ?? { errors: [], summary: null, applied: false };
	}
}
