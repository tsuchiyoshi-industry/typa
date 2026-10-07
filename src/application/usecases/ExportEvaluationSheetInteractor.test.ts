import { describe, expect, it, vi } from "vitest";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import { exportData } from "../../test/exportFixture";
import { output, sheetRepository as repositoryWithSheet, sheet } from "../../test/fixtures";
import type { SheetPdfGateway } from "../ports/SheetPdfGateway";
import { ExportEvaluationSheetInteractor } from "./ExportEvaluationSheetInteractor";

const request = (id: number) => ({
	sheetId: 100,
	employeeId: 1,
	periodId: 10,
	currentEmployeeId: id,
});
/** 出力できるのは評価が確定したシートだけ。 */
const sheetRepository = (status = EvaluationStatus.FINALIZED) => {
	const repo = repositoryWithSheet();
	repo.findById.mockResolvedValue(sheet(status));
	return repo;
};
const gateway = () => ({
	selectDestination: vi
		.fn<SheetPdfGateway["selectDestination"]>()
		.mockResolvedValue("C:\\test\\sheet.pdf"),
	generate: vi.fn<SheetPdfGateway["generate"]>().mockResolvedValue("C:\\test\\sheet.pdf"),
});

describe("PDF use case with an injected gateway", () => {
	it.each([1, 4])("denies role %s before export query or dialog", async (id) => {
		const repo = sheetRepository(),
			pdf = gateway(),
			out = output<never>();
		await new ExportEvaluationSheetInteractor(repo, pdf).execute(request(id), out);
		expect(repo.findExportData).not.toHaveBeenCalled();
		expect(pdf.selectDestination).not.toHaveBeenCalled();
		expect(pdf.generate).not.toHaveBeenCalled();
		expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
	});
	it.each([EvaluationStatus.DRAFT, EvaluationStatus.SUBMITTED, EvaluationStatus.FIRST_EVALUATED])(
		"denies evaluators before the evaluation is finalized (%s)",
		async (status) => {
			for (const id of [2, 3]) {
				const repo = sheetRepository(status),
					pdf = gateway(),
					out = output<never>();
				await new ExportEvaluationSheetInteractor(repo, pdf).execute(request(id), out);
				expect(repo.findExportData).not.toHaveBeenCalled();
				expect(pdf.selectDestination).not.toHaveBeenCalled();
				expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
			}
		},
	);
	it.each([2, 3])("masks every secondary export field for role %s", async (id) => {
		const repo = sheetRepository(),
			pdf = gateway(),
			out = output<never>();
		repo.findExportData.mockResolvedValue(exportData());
		await new ExportEvaluationSheetInteractor(repo, pdf).execute(request(id), out);
		const data = pdf.generate.mock.calls[0][0];
		expect(data).not.toHaveProperty("totalScore");
		const mask = (value: string) => (id === 3 ? value : "*");
		expect(data).toMatchObject({
			finalEvaluationRank: mask("A＋"),
			secondOverallComment: mask("二次総評"),
			objectiveSecondRate: mask("100"),
			objectiveEvaluationScore: mask("20"),
			commonEvaluationSecondRate: mask("100"),
			commonEvaluationEvaluationScore: mask("80"),
			totalEvaluationScore: mask("100"),
			firstOverallComment: "一次総評",
		});
		expect(data.objectives[0].evaluatorScore).toBe(mask("4"));
		expect(data.commonEvaluations[0]).toMatchObject({
			evaluatorScore: mask("5"),
			evaluatorComment: mask("二次コメント"),
		});
		expect(out.present).toHaveBeenCalledWith(
			expect.objectContaining({ success: true, fileName: "C:\\test\\sheet.pdf" }),
		);
	});
	it.each(["sheet", "exportData"])("missing %s never opens a dialog", async (kind) => {
		const repo = sheetRepository(),
			pdf = gateway(),
			out = output<never>();
		if (kind === "sheet") {
			repo.findById.mockResolvedValue(null);
		}
		await new ExportEvaluationSheetInteractor(repo, pdf).execute(request(2), out);
		expect(pdf.selectDestination).not.toHaveBeenCalled();
		expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
	});
	it("cancel does not generate or report success", async () => {
		const repo = sheetRepository(),
			pdf = gateway(),
			out = output<never>();
		repo.findExportData.mockResolvedValue(exportData());
		pdf.selectDestination.mockResolvedValue(null);
		await new ExportEvaluationSheetInteractor(repo, pdf).execute(request(2), out);
		expect(pdf.generate).not.toHaveBeenCalled();
		expect(out.present).not.toHaveBeenCalled();
	});
	it.each([new Error("compile failed"), "compile failed"])(
		"reports generation failure %s",
		async (error) => {
			vi.spyOn(console, "error").mockImplementation(() => {});
			const repo = sheetRepository(),
				pdf = gateway(),
				out = output<never>();
			repo.findExportData.mockResolvedValue(exportData());
			pdf.generate.mockRejectedValue(error);
			await new ExportEvaluationSheetInteractor(repo, pdf).execute(request(2), out);
			expect(out.present).toHaveBeenCalledWith({
				success: false,
				message: "PDF生成エラー: compile failed",
			});
		},
	);
	it.each([new Error("read failed"), "read failed"])(
		"reports repository failure %s",
		async (error) => {
			vi.spyOn(console, "error").mockImplementation(() => {});
			const repo = sheetRepository(),
				pdf = gateway(),
				out = output<never>();
			repo.findById.mockRejectedValue(error);
			await new ExportEvaluationSheetInteractor(repo, pdf).execute(request(2), out);
			expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
			expect(pdf.generate).not.toHaveBeenCalled();
		},
	);
	it("sanitizes database-supplied default filename", async () => {
		const repo = sheetRepository(),
			pdf = gateway();
		repo.findExportData.mockResolvedValue({
			...exportData(),
			employeeName: "../../name",
			periodName: "test:period",
		});
		await new ExportEvaluationSheetInteractor(repo, pdf).execute(request(2), output<never>());
		expect(pdf.selectDestination).toHaveBeenCalledWith("評価シート_.._.._name_test_period.pdf");
	});
});
