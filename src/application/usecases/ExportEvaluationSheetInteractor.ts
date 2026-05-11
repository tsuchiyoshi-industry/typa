import { invoke } from "@tauri-apps/api/core";
import { exists } from "@tauri-apps/plugin-fs";
import { download } from "@tauri-apps/plugin-upload";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import type {
	ExportSheetOutputDto,
	ExportSheetRequestDto,
	SheetExportDataDto,
} from "../dtos/ExportSheetDto";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export type ExportEvaluationSheetOutputPort = OutputPort<ExportSheetOutputDto>;

export class ExportEvaluationSheetInteractor
	implements UseCase<ExportSheetRequestDto, ExportEvaluationSheetOutputPort>
{
	constructor(private readonly sheetRepository: EvaluationSheetRepository) {}

	async execute(
		request: ExportSheetRequestDto,
		presenter: ExportEvaluationSheetOutputPort,
	): Promise<void> {
		try {
			// ①シートの出力用定型情報を取得
			const exportData = await this.sheetRepository.findExportData(request.sheetId);

			if (!exportData) {
				presenter.present({
					success: false,
					message: "評価シートが見つかりませんでした",
				});
				return;
			}

			// ②Tauriコマンドを使用してTypstでPDFを生成
			const pdfFilePath = await this.generatePdfWithTypst(exportData);
			const fileName = `評価シート_${exportData.employeeName}_${exportData.periodName}.pdf`;

			// ③ファイルの存在チェック
			const fileExists = await exists(pdfFilePath);
			if (!fileExists) {
				presenter.present({
					success: false,
					message: "PDFファイルの生成に失敗しました",
				});
				return;
			}

			// ④Tauriのdownload関数を使いPDFをダウンロード
			await download(`file://${pdfFilePath}`, fileName);

			presenter.present({
				success: true,
				message: "PDFの出力に成功しました",
				fileName,
			});
		} catch (error) {
			presenter.present({
				success: false,
				message: error instanceof Error ? error.message : "PDFの出力中にエラーが発生しました",
			});
		}
	}

	private async generatePdfWithTypst(data: SheetExportDataDto): Promise<string> {
		// Rust側のTauriコマンドを呼び出してPDFを生成
		const pdfPath = await invoke<string>("generate_pdf_with_typst", {
			data: {
				sheet_id: data.sheetId,
				employee_name: data.employeeName,
				employee_no: data.employeeNo,
				period_name: data.periodName,
				period_start: data.periodStart,
				period_end: data.periodEnd,
				primary_evaluator: data.primaryEvaluator,
				secondary_evaluator: data.secondaryEvaluator,
				status: data.status,
				total_score: data.totalScore,
				objectives: data.objectives.map((obj) => ({
					id: obj.id,
					title: obj.title,
					description: obj.description,
					target_date: obj.targetDate,
					status: obj.status,
					self_score: obj.selfScore,
					evaluator_score: obj.evaluatorScore,
					self_comment: obj.selfComment,
					evaluator_comment: obj.evaluatorComment,
				})),
				common_evaluations: data.commonEvaluations.map((item) => ({
					item_name: item.itemName,
					self_score: item.selfScore,
					evaluator_score: item.evaluatorScore,
					self_comment: item.selfComment,
					evaluator_comment: item.evaluatorComment,
				})),
			},
		});

		return pdfPath;
	}
}
