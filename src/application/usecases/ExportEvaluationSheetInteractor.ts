import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import type { ExportSheetOutputDto, ExportSheetRequestDto } from "../dtos/ExportSheetDto";
import { toSheetExportDataDto } from "../dtos/ExportSheetMapper";
import type { OutputPort } from "../ports/OutputPort";
import type { SheetPdfGateway } from "../ports/SheetPdfGateway";
import type { UseCase } from "../ports/UseCase";

export type ExportEvaluationSheetOutputPort = OutputPort<ExportSheetOutputDto>;

export class ExportEvaluationSheetInteractor
	implements UseCase<ExportSheetRequestDto, ExportEvaluationSheetOutputPort>
{
	constructor(
		private readonly sheetRepository: EvaluationSheetRepository,
		private readonly employeeRepository: EmployeeRepository,
		private readonly pdfGateway: SheetPdfGateway,
	) {}

	async execute(
		request: ExportSheetRequestDto,
		presenter: ExportEvaluationSheetOutputPort,
	): Promise<void> {
		try {
			// ① 権限チェック: 被評価者は出力不可、評価者(一次・二次)のみ、評価が確定したシートを出力可能
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
						: policy.canViewSheet() && !sheet.status.isFinalized()
							? "評価が確定したシートのみ出力できます。"
							: "評価者のみ評価シートを出力できます。",
				});
				return;
			}

			// ② 画面と同じシートから帳票のデータを作り、一次評価者向けには二次評価の内容を伏せる
			const gradeName = await this.employeeRepository.findGradeName(sheet.gradeId);
			const exportData = toSheetExportDataDto(sheet, gradeName, policy.canExportSecondEvaluation());

			// ③ 保存先を選択するダイアログを表示
			const safePart = (value: string) =>
				value
					.replace(/[<>:"/\\|?*]/g, "_")
					.replace(/\p{Cc}/gu, "_")
					.slice(0, 80);
			const defaultName = `評価シート_${safePart(exportData.employeeName)}_${safePart(exportData.periodName)}.pdf`;
			const filePath = await this.pdfGateway.selectDestination(defaultName);

			// キャンセルされた場合は何もしない
			if (!filePath) {
				return;
			}

			// ④ Tauriコマンドを使用してPDFを生成
			// filePath（保存先）を引数に追加して渡す
			try {
				await this.pdfGateway.generate(exportData, filePath);
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
}
