import { describe, expect, it, vi } from "vitest";
import { Employee } from "../../domain/entities/Employee";
import { EvaluationPeriod } from "../../domain/entities/EvaluationPeriod";
import { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import {
	employee,
	employeeRepository,
	milestone,
	output,
	sheetRepository as repositoryWithSheet,
	sheet,
} from "../../test/fixtures";
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
const interactor = (repo: ReturnType<typeof sheetRepository>, pdf: ReturnType<typeof gateway>) =>
	new ExportEvaluationSheetInteractor(repo, employeeRepository(), pdf);
const gateway = () => ({
	selectDestination: vi
		.fn<SheetPdfGateway["selectDestination"]>()
		.mockResolvedValue("C:\\test\\sheet.pdf"),
	generate: vi.fn<SheetPdfGateway["generate"]>().mockResolvedValue("C:\\test\\sheet.pdf"),
	generateOverview: vi.fn<SheetPdfGateway["generateOverview"]>(),
});

describe("PDF use case with an injected gateway", () => {
	it("denies an employee outside the evaluation before export query or dialog", async () => {
		const repo = sheetRepository(),
			pdf = gateway(),
			out = output<never>();
		await interactor(repo, pdf).execute(request(4), out);
		expect(pdf.selectDestination).not.toHaveBeenCalled();
		expect(pdf.generate).not.toHaveBeenCalled();
		expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
	});
	it.each([EvaluationStatus.DRAFT, EvaluationStatus.SUBMITTED, EvaluationStatus.FIRST_EVALUATED])(
		"denies the subject and evaluators before the evaluation is finalized (%s)",
		async (status) => {
			for (const id of [1, 2, 3]) {
				const repo = sheetRepository(status),
					pdf = gateway(),
					out = output<never>();
				await interactor(repo, pdf).execute(request(id), out);
				expect(pdf.selectDestination).not.toHaveBeenCalled();
				expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
			}
		},
	);
	it.each([1, 2, 3])(
		"exports the same complete sheet for the subject and both evaluators (%s)",
		async (id) => {
			const repo = sheetRepository(),
				pdf = gateway(),
				out = output<never>();
			await interactor(repo, pdf).execute(request(id), out);
			const data = pdf.generate.mock.calls[0][0];
			const scores = sheet(EvaluationStatus.FINALIZED).allocatedScores;
			expect(data).toMatchObject({
				finalEvaluationRank: "A+",
				firstOverallComment: "一次総評",
				secondOverallComment: "二次総評",
				objectiveSecondRate: String(scores.objectiveSecondRate),
				objectiveEvaluationScore: String(scores.objectiveEvaluationScore),
				commonEvaluationSecondRate: String(scores.commonEvaluationSecondRate),
				commonEvaluationEvaluationScore: String(scores.commonEvaluationEvaluationScore),
				totalEvaluationScore: String(scores.totalEvaluationScore),
			});
			expect(data.objectives[0].secondScore).toBe("4");
			expect(data.commonEvaluations[0]).toMatchObject({ firstScore: 3, secondScore: "4" });
			expect(out.present).toHaveBeenCalledWith(
				expect.objectContaining({ success: true, fileName: "C:\\test\\sheet.pdf" }),
			);
		},
	);
	it("prints the grade held when the sheet was created, not the employee's current grade", async () => {
		// 等級 3 のときに作ったシートを、等級 5 に上がったあとで出力する
		const repo = repositoryWithSheet(),
			employees = employeeRepository(),
			pdf = gateway();
		repo.findById.mockResolvedValue(sheet(EvaluationStatus.FINALIZED, 3));
		employees.findGradeName.mockImplementation(async (id) => (id === 3 ? "技術3級" : "技術5級"));
		await new ExportEvaluationSheetInteractor(repo, employees, pdf).execute(
			request(2),
			output<never>(),
		);
		expect(employee().gradeId).toBe(5);
		expect(employees.findGradeName).toHaveBeenCalledWith(3);
		expect(pdf.generate.mock.calls[0][0].gradeName).toBe("技術3級");
	});
	it("missing sheet never opens a dialog", async () => {
		const repo = sheetRepository(),
			pdf = gateway(),
			out = output<never>();
		repo.findById.mockResolvedValue(null);
		await interactor(repo, pdf).execute(request(2), out);
		expect(pdf.selectDestination).not.toHaveBeenCalled();
		expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
	});
	it("cancel does not generate or report success", async () => {
		const repo = sheetRepository(),
			pdf = gateway(),
			out = output<never>();
		pdf.selectDestination.mockResolvedValue(null);
		await interactor(repo, pdf).execute(request(2), out);
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
			pdf.generate.mockRejectedValue(error);
			await interactor(repo, pdf).execute(request(2), out);
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
			await interactor(repo, pdf).execute(request(2), out);
			expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
			expect(pdf.generate).not.toHaveBeenCalled();
		},
	);
	it("sanitizes database-supplied default filename", async () => {
		const repo = sheetRepository(),
			pdf = gateway();
		repo.findById.mockResolvedValue(
			EvaluationSheet.create({
				sheetId: 100,
				subject: new Employee(1, "../../name", "TEST001", 1, "技術", 5, 2, 3),
				evaluationPeriod: new EvaluationPeriod(10, "test:period", "2026-04-01", "2026-09-30", true),
				primaryEvaluatorName: "一次",
				secondaryEvaluatorName: "二次",
				objectives: [milestone()],
				status: EvaluationStatus.FINALIZED,
			}),
		);
		await interactor(repo, pdf).execute(request(2), output<never>());
		expect(pdf.selectDestination).toHaveBeenCalledWith("評価シート_.._.._name_test_period.pdf");
	});
});
