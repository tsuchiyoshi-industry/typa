import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import type { SheetPdfGateway } from "../ports/SheetPdfGateway";
import type { UseCase } from "../ports/UseCase";
import {
	type ExportEvaluationSheetOutputPort,
	safeFileNamePart,
} from "./ExportEvaluationSheetInteractor";
import { loadSheetOverview } from "./FetchSheetOverviewInteractor";

export interface ExportSheetOverviewRequest {
	periodId: number;
}

const dateFormat = new Intl.DateTimeFormat("ja-JP", {
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
});
const dateTimeFormat = new Intl.DateTimeFormat("ja-JP", {
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
});

/** 全社の評価シート一覧を、評価期間ごとに1つの PDF にする。出力できるのは一覧を見られる人(Admin)だけ。 */
export class ExportSheetOverviewInteractor
	implements UseCase<ExportSheetOverviewRequest, ExportEvaluationSheetOutputPort>
{
	constructor(
		private readonly employeeMasterRepository: EmployeeMasterRepository,
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
		private readonly pdfGateway: SheetPdfGateway,
		private readonly now: () => Date = () => new Date(),
	) {}

	async execute(
		request: ExportSheetOverviewRequest,
		presenter: ExportEvaluationSheetOutputPort,
	): Promise<void> {
		try {
			// ① 権限チェックと読み直し。画面に出ていた行ではなく、いまの行を出力する
			const overview = await loadSheetOverview(
				this.employeeMasterRepository,
				this.evaluationSheetRepository,
			);
			if (!overview) {
				presenter.present({
					success: false,
					message: "全社の評価シートの一覧は、Admin だけが出力できます。",
				});
				return;
			}
			const rows = overview.rows
				.filter((row) => row.periodId === request.periodId)
				.sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));
			const period = rows[0];
			if (!period) {
				presenter.present({ success: false, message: "この評価期間の評価シートはありません。" });
				return;
			}

			// ② 保存先を選択するダイアログを表示。キャンセルされた場合は何もしない
			const filePath = await this.pdfGateway.selectDestination(
				`評価シート一覧_${safeFileNamePart(period.periodName)}.pdf`,
			);
			if (!filePath) {
				return;
			}

			// ③ PDFを生成
			await this.pdfGateway.generateOverview(
				{
					periodName: period.periodName,
					periodStart: period.periodStart,
					periodEnd: period.periodEnd,
					issuedAt: dateTimeFormat.format(this.now()),
					issuedBy: overview.viewer.name,
					rows: rows.map((row) => ({
						employeeNo: row.employeeNo,
						employeeName: row.employeeName,
						gradeName: row.gradeName,
						status: row.status.toString(),
						primaryEvaluator: row.primaryEvaluatorName,
						secondaryEvaluator: row.secondaryEvaluatorName,
						// 帳票にだけ載せる、段ごとのランクと総評
						firstRank: row.firstRank ?? "",
						firstComment: row.firstOverallComment,
						finalRank: row.finalRank ?? "",
						finalScore: row.finalScore === null ? "" : `${row.finalScore} 点`,
						secondComment: row.secondOverallComment,
						updatedAt: dateFormat.format(new Date(row.updatedAt)),
					})),
				},
				filePath,
			);
			presenter.present({ success: true, message: "PDFの出力に成功しました", fileName: filePath });
		} catch (error) {
			console.error("Sheet overview export error:", error);
			presenter.present({
				success: false,
				message: error instanceof Error ? error.message : "PDFの出力中にエラーが発生しました",
			});
		}
	}
}
