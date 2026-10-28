import { describe, expect, it, vi } from "vitest";
import { EmployeeProfile } from "../../domain/entities/EmployeeProfile";
import { masterRepository, output, profile } from "../../test/fixtures";
import {
	ChangeSheetGradeInteractor,
	describeSheetGradeChangeError,
} from "./ChangeSheetGradeInteractor";

const request = {
	sheetId: 100,
	gradeId: 2,
	expectedGradeId: 1,
	expectedStatus: "submitted",
	reason: "等級の登録誤り",
};
const setup = (actor: EmployeeProfile | null = profile("Admin"), deleted = 3) => {
	const master = masterRepository();
	master.findCurrentEmployeeProfile.mockResolvedValue(actor);
	const repository = { execute: vi.fn().mockResolvedValue(deleted) };
	const usecase = new ChangeSheetGradeInteractor(repository, master);
	return { repository, usecase, out: output<{ message: string }>() };
};
const disabledAdmin = () =>
	Object.assign(Object.create(EmployeeProfile.prototype), profile("Admin"), { enabled: false });

describe("changing the grade a sheet was created with", () => {
	it("changes it and says how many common evaluation entries were deleted", async () => {
		const { usecase, repository, out } = setup();
		expect(await usecase.execute(request, out)).toEqual({ ok: true, value: undefined });
		expect(repository.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				sheetId: 100,
				gradeId: 2,
				expectedGradeId: 1,
				reason: "等級の登録誤り",
			}),
		);
		expect(out.present).toHaveBeenCalledWith({
			message: "等級を変更し、共通評価の入力 3 件を削除しました。監査ログに記録しました。",
		});
	});

	it("says nothing was deleted when there was no common evaluation input", async () => {
		const { usecase, out } = setup(profile("Admin"), 0);
		await usecase.execute(request, out);
		expect(out.present).toHaveBeenCalledWith({
			message: "等級を変更しました。共通評価の入力はありませんでした。監査ログに記録しました。",
		});
	});

	it.each([
		["an Employee", profile("Employee")],
		["a Reviewer", profile("Reviewer")],
		["a suspended Admin", disabledAdmin()],
		["an unlinked account", null],
	])("denies %s before touching anything", async (_, actor) => {
		const { usecase, repository, out } = setup(actor);
		expect(await usecase.execute(request, out)).toEqual({
			ok: false,
			error: { kind: "forbidden" },
		});
		expect(repository.execute).not.toHaveBeenCalled();
		expect(out.present).not.toHaveBeenCalled();
	});

	it.each([
		[{ gradeId: null }, "gradeRequired"],
		[{ gradeId: 1 }, "sameGrade"],
		[{ expectedStatus: "finalized" }, "firstEvaluationConfirmed"],
		[{ reason: "" }, "reasonInvalid"],
	] as const)("stops %o before touching anything", async (override, kind) => {
		const { usecase, repository, out } = setup();
		expect(await usecase.execute({ ...request, ...override }, out)).toEqual({
			ok: false,
			error: { kind },
		});
		expect(repository.execute).not.toHaveBeenCalled();
	});

	it("passes a server refusal through without claiming success", async () => {
		const { usecase, repository, out } = setup();
		repository.execute.mockRejectedValueOnce(new Error("シートの状態か等級が変わりました"));
		await expect(usecase.execute(request, out)).rejects.toThrow("変わりました");
		expect(out.present).not.toHaveBeenCalled();
	});

	it("has a message for every failure", () => {
		for (const kind of [
			"forbidden",
			"invalidSheetId",
			"gradeRequired",
			"sameGrade",
			"invalidStatus",
			"firstEvaluationConfirmed",
			"reasonInvalid",
		] as const) {
			expect(describeSheetGradeChangeError({ kind })).toMatch(/./);
		}
	});
});
