import { describe, expect, it, vi } from "vitest";
import type { EvaluationSheetOverviewRow } from "../../domain/repositories/EvaluationSheetRepository";
import { canViewAllSheets } from "../../domain/services/EmployeeMasterAccessService";
import { EmployeeRole } from "../../domain/valueObjects/EmployeeRole";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import { masterRepository, output, profile, sheetRepository } from "../../test/fixtures";
import type { ExportSheetOutputDto } from "../dtos/ExportSheetDto";
import type { SheetPdfGateway } from "../ports/SheetPdfGateway";
import { ExportSheetOverviewInteractor } from "./ExportSheetOverviewInteractor";
import {
	FetchSheetOverviewInteractor,
	type FetchSheetOverviewResponse,
} from "./FetchSheetOverviewInteractor";

const row = (
	id: number,
	periodId: number,
	employeeNo: string,
	status = EvaluationStatus.SUBMITTED,
): EvaluationSheetOverviewRow => ({
	id,
	periodId,
	employeeId: id,
	status,
	totalScore: 0,
	createdAt: "2026-04-01T00:00:00Z",
	updatedAt: "2026-10-05T03:00:00Z",
	periodName: `${periodId}期: 本番`,
	periodStart: "2026-03-23",
	periodEnd: "2027-02-19",
	employeeName: `社員${id}`,
	employeeNo,
	gradeName: "総合Ⅱ級",
	primaryEvaluatorName: "一次",
	secondaryEvaluatorName: "なし",
	finalScore: status.isFinalized() ? 88 : null,
	finalRank: status.isFinalized() ? "A" : null,
	firstRank: status.isFirstEvaluationConfirmed() ? "B+" : null,
	firstOverallComment: status.isDraft() ? "" : "一次の総評",
	secondOverallComment: status.isFinalized() ? "二次の総評" : "",
});
/** role: ログイン中の人の権限。null は社員を特定できない。 */
const setup = (role: string | null) => {
	const master = masterRepository();
	master.findCurrentEmployeeProfile.mockResolvedValue(role === null ? null : profile(role, 9));
	const sheets = sheetRepository();
	sheets.findOverview.mockResolvedValue([
		row(3, 26, "E003", EvaluationStatus.FINALIZED),
		row(1, 26, "E001", EvaluationStatus.DRAFT),
		row(2, 25, "E002"),
	]);
	const pdf = {
		selectDestination: vi
			.fn<SheetPdfGateway["selectDestination"]>()
			.mockResolvedValue("C:\\test\\list.pdf"),
		generate: vi.fn<SheetPdfGateway["generate"]>(),
		generateOverview: vi
			.fn<SheetPdfGateway["generateOverview"]>()
			.mockResolvedValue("C:\\test\\list.pdf"),
	};
	const exporter = new ExportSheetOverviewInteractor(
		master,
		sheets,
		pdf,
		() => new Date(2026, 9, 8, 14, 30),
	);
	return { master, sheets, pdf, exporter, out: output<ExportSheetOutputDto>() };
};

describe("the overview of every employee's sheets", () => {
	it("is an Admin-only permission in the domain", () => {
		expect(EmployeeRole.ALL.filter(canViewAllSheets)).toEqual([EmployeeRole.ADMIN]);
	});

	it.each(["Reviewer", "Employee", "unknown", null])(
		"is not read for %s, who gets no list at all",
		async (role) => {
			const { master, sheets } = setup(role);
			const out = output<FetchSheetOverviewResponse>();
			await new FetchSheetOverviewInteractor(master, sheets).execute({}, out);
			expect(sheets.findOverview).not.toHaveBeenCalled();
			expect(out.present).toHaveBeenCalledWith({ sheets: null });
		},
	);

	it("gives an Admin every sheet with its stage, evaluators and finalized result, drafts included", async () => {
		const { master, sheets } = setup("Admin");
		const out = output<FetchSheetOverviewResponse>();
		await new FetchSheetOverviewInteractor(master, sheets).execute({}, out);
		const listed = out.present.mock.calls[0][0].sheets;
		expect(listed?.map((sheet) => [sheet.employeeNo, sheet.status])).toEqual([
			["E003", "finalized"],
			["E001", "draft"],
			["E002", "submitted"],
		]);
		expect(listed?.[0]).toMatchObject({
			periodId: 26,
			startDate: "2026-03-23",
			gradeName: "総合Ⅱ級",
			primaryEvaluator: "一次",
			secondaryEvaluator: "なし",
			finalScore: 88,
			finalRank: "A",
		});
		// 確定していないシートに、結果はない
		expect(listed?.[1]).toMatchObject({ finalScore: null, finalRank: null });
		// 段ごとのランクと総評は帳票にだけ載せる。画面の一覧には渡さない
		for (const sheet of listed ?? []) {
			expect(sheet).not.toHaveProperty("firstRank");
			expect(sheet).not.toHaveProperty("firstOverallComment");
			expect(sheet).not.toHaveProperty("secondOverallComment");
		}
	});

	it("does not present an empty list when the overview cannot be read", async () => {
		const { master, sheets } = setup("Admin");
		sheets.findOverview.mockRejectedValue(new Error("DB"));
		const out = output<FetchSheetOverviewResponse>();
		await expect(new FetchSheetOverviewInteractor(master, sheets).execute({}, out)).rejects.toThrow(
			"DB",
		);
		expect(out.present).not.toHaveBeenCalled();
	});
});

describe("the overview PDF", () => {
	it.each(["Reviewer", "Employee", null])(
		"is refused for %s before any read or dialog",
		async (role) => {
			const { sheets, pdf, exporter, out } = setup(role);
			await exporter.execute({ periodId: 26 }, out);
			expect(sheets.findOverview).not.toHaveBeenCalled();
			expect(pdf.selectDestination).not.toHaveBeenCalled();
			expect(pdf.generateOverview).not.toHaveBeenCalled();
			expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
		},
	);

	it("lists one period in employee number order, with who issued it and when", async () => {
		const { pdf, exporter, out } = setup("Admin");
		await exporter.execute({ periodId: 26 }, out);
		// 期間名はファイル名に使えない文字を含んでいてもよい
		expect(pdf.selectDestination).toHaveBeenCalledWith("評価シート一覧_26期_ 本番.pdf");
		expect(pdf.generateOverview).toHaveBeenCalledWith(
			{
				periodName: "26期: 本番",
				periodStart: "2026-03-23",
				periodEnd: "2027-02-19",
				issuedAt: "2026/10/08 14:30",
				issuedBy: "テスト9",
				rows: [
					{
						employeeNo: "E001",
						employeeName: "社員1",
						gradeName: "総合Ⅱ級",
						status: "draft",
						primaryEvaluator: "一次",
						secondaryEvaluator: "なし",
						// まだ無いものは空欄にする
						firstRank: "",
						firstComment: "",
						finalRank: "",
						finalScore: "",
						secondComment: "",
						updatedAt: expect.any(String),
					},
					{
						employeeNo: "E003",
						employeeName: "社員3",
						gradeName: "総合Ⅱ級",
						status: "finalized",
						primaryEvaluator: "一次",
						secondaryEvaluator: "なし",
						firstRank: "B+",
						firstComment: "一次の総評",
						finalRank: "A",
						finalScore: "88 点",
						secondComment: "二次の総評",
						updatedAt: expect.stringMatching(/^2026\/10\/0[45]$/),
					},
				],
			},
			"C:\\test\\list.pdf",
		);
		expect(out.present).toHaveBeenCalledWith(
			expect.objectContaining({ success: true, fileName: "C:\\test\\list.pdf" }),
		);
	});

	it("opens no dialog for a period without sheets", async () => {
		const { pdf, exporter, out } = setup("Admin");
		await exporter.execute({ periodId: 99 }, out);
		expect(pdf.selectDestination).not.toHaveBeenCalled();
		expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
	});

	it("neither generates nor reports anything when the save dialog is cancelled", async () => {
		const { pdf, exporter, out } = setup("Admin");
		pdf.selectDestination.mockResolvedValue(null);
		await exporter.execute({ periodId: 26 }, out);
		expect(pdf.generateOverview).not.toHaveBeenCalled();
		expect(out.present).not.toHaveBeenCalled();
	});

	it.each([new Error("compile failed"), "compile failed"])(
		"reports a generation failure (%s) instead of success",
		async (error) => {
			vi.spyOn(console, "error").mockImplementation(() => {});
			const { pdf, exporter, out } = setup("Admin");
			pdf.generateOverview.mockRejectedValue(error);
			await exporter.execute({ periodId: 26 }, out);
			expect(out.present).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({ success: false }),
			);
		},
	);
});
