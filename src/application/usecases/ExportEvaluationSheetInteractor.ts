import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import type {
	ExportSheetOutputDto,
	ExportSheetRequestDto,
	SheetExportDataDto,
} from "../dtos/ExportSheetDto";
import { toSheetExportDataDto } from "../dtos/ExportSheetMapper";
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
			// ① 権限チェック: 被評価者は出力不可、評価者(一次・二次)のみ出力可能
			const sheet = await this.sheetRepository.findById(request.sheetId);
			if (!sheet) {
				presenter.present({
					success: false,
					message: "評価シートが見つかりませんでした",
				});
				return;
			}

			const policy = EvaluationSheetAccessPolicy.for(request.currentEmployeeId, sheet);
			if (!policy.canExportSheet()) {
				presenter.present({
					success: false,
					message: policy.isSubject()
						? "本人は評価シートを出力できません。"
						: "評価者のみ評価シートを出力できます。",
				});
				return;
			}

			// ② シートの出力用定型情報を取得し、一次評価者向けには二次評価の内容を伏せる
			const rawExportData = await this.sheetRepository.findExportData(request.sheetId);
			if (!rawExportData) {
				presenter.present({
					success: false,
					message: "評価シートが見つかりませんでした",
				});
				return;
			}
			const exportData = toSheetExportDataDto(rawExportData, policy.canExportSecondEvaluation());

			// ③ 保存先を選択するダイアログを表示
			const defaultName = `評価シート_${exportData.employeeName}_${exportData.periodName}.pdf`;
			const filePath = await save({
				title: "評価シートを保存",
				defaultPath: defaultName,
				filters: [
					{
						name: "PDFファイル",
						extensions: ["pdf"],
					},
				],
			});

			// キャンセルされた場合は何もしない
			if (!filePath) {
				return;
			}

			// ④ Tauriコマンドを使用してPDFを生成
			// filePath（保存先）を引数に追加して渡す
			try {
				await this.generatePdfWithTypst(exportData, filePath);
				console.log("PDF saved at:", filePath);
			} catch (error) {
				console.error("PDF generation error:", error);
				presenter.present({
					success: false,
					message: `PDF生成エラー: ${error instanceof Error ? error.message : String(error)}`,
				});
				return;
			}

			// 成功通知
			presenter.present({
				success: true,
				message: "PDFの出力に成功しました",
				fileName: filePath,
			});
		} catch (error) {
			console.error("Export error:", error);
			presenter.present({
				success: false,
				message: error instanceof Error ? error.message : "PDFの出力中にエラーが発生しました",
			});
		}
	}

	private async generatePdfWithTypst(
		data: SheetExportDataDto,
		outputPath: string,
	): Promise<string> {
		return await invoke<string>("generate_pdf_with_typst", {
			data,
			outputPath,
		});
	}
}
