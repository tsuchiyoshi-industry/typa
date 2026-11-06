import { describe, expect, it, vi } from "vitest";
import { EmployeeProfile } from "../../domain/entities/EmployeeProfile";
import type { CommonGoalSet, GradeEntry, GradeMaster } from "../../domain/entities/GradeMaster";
import type { GradeMasterRepository } from "../../domain/repositories/GradeMasterRepository";
import { masterRepository, output, profile } from "../../test/fixtures";
import {
	DeleteCommonGoalSetInteractor,
	DeleteEmployeeGradeInteractor,
	describeGradeMasterError,
	LoadGradeMasterInteractor,
	SaveCommonGoalSetInteractor,
	SaveEmployeeGradeInteractor,
} from "./GradeMasterInteractors";

const grade: GradeEntry = { id: 3, name: "技能1級", itemSetId: 2, employeeCount: 0, sheetCount: 6 };
const set: CommonGoalSet = {
	id: 2,
	name: "一般",
	sheetCount: 4,
	items: [{ id: 10, title: "協調性", description: "説明", weight: 2 }],
};
const data: GradeMaster = { grades: [grade], itemSets: [set] };

const setup = (actor: EmployeeProfile | null = profile("Admin")) => {
	const employees = masterRepository();
	employees.findCurrentEmployeeProfile.mockResolvedValue(actor);
	const repository = {
		load: vi.fn<GradeMasterRepository["load"]>().mockResolvedValue(data),
		saveGrade: vi.fn<GradeMasterRepository["saveGrade"]>().mockResolvedValue(3),
		deleteGrade: vi.fn<GradeMasterRepository["deleteGrade"]>().mockResolvedValue(undefined),
		saveCommonGoalSet: vi.fn<GradeMasterRepository["saveCommonGoalSet"]>().mockResolvedValue(2),
		deleteCommonGoalSet: vi
			.fn<GradeMasterRepository["deleteCommonGoalSet"]>()
			.mockResolvedValue(undefined),
	} satisfies GradeMasterRepository;
	return {
		repository,
		load: new LoadGradeMasterInteractor(repository, employees),
		saveGrade: new SaveEmployeeGradeInteractor(repository, employees),
		deleteGrade: new DeleteEmployeeGradeInteractor(repository, employees),
		saveSet: new SaveCommonGoalSetInteractor(repository, employees),
		deleteSet: new DeleteCommonGoalSetInteractor(repository, employees),
	};
};
const disabledAdmin = () =>
	Object.assign(Object.create(EmployeeProfile.prototype), profile("Admin"), { enabled: false });
const forbidden = { ok: false, error: { kind: "forbidden" } };

describe("the grade master", () => {
	it("loads grades and common goals for an Admin", async () => {
		const { load } = setup();
		const out = output<GradeMaster>();
		expect(await load.execute(undefined, out)).toEqual({ ok: true, value: undefined });
		expect(out.present).toHaveBeenCalledWith(data);
	});

	it.each([
		["an Employee", profile("Employee")],
		["a Reviewer", profile("Reviewer")],
		["a suspended Admin", disabledAdmin()],
		["an unlinked account", null],
	])("denies %s every operation before reading or writing anything", async (_, actor) => {
		const { repository, load, saveGrade, deleteGrade, saveSet, deleteSet } = setup(actor);
		const out = output<never>();
		expect(await load.execute(undefined, out)).toEqual(forbidden);
		expect(await saveGrade.execute({ name: "総合1級", itemSetId: 2, shown: null }, out)).toEqual(
			forbidden,
		);
		expect(await deleteGrade.execute({ grade: { ...grade, sheetCount: 0 } }, out)).toEqual(
			forbidden,
		);
		expect(await saveSet.execute({ name: "一般", items: set.items, shown: set }, out)).toEqual(
			forbidden,
		);
		expect(await deleteSet.execute({ set: { ...set, sheetCount: 0 }, grades: [] }, out)).toEqual(
			forbidden,
		);
		for (const call of Object.values(repository)) {
			expect(call).not.toHaveBeenCalled();
		}
		expect(out.present).not.toHaveBeenCalled();
	});
});

describe("saving a grade", () => {
	it("adds a grade", async () => {
		const { repository, saveGrade } = setup();
		const out = output<{ id: number; message: string }>();
		await saveGrade.execute({ name: " 総合1級 ", itemSetId: 2, shown: null }, out);
		expect(repository.saveGrade).toHaveBeenCalledWith(
			expect.objectContaining({ id: null, name: "総合1級", itemSetId: 2, expected: null }),
		);
		expect(out.present).toHaveBeenCalledWith({ id: 3, message: "等級「総合1級」を追加しました。" });
	});

	it("says existing sheets keep their common goals when a grade moves to another set", async () => {
		const { saveGrade } = setup();
		const out = output<{ id: number; message: string }>();
		await saveGrade.execute({ name: "技能1級", itemSetId: 1, shown: grade }, out);
		expect(out.present).toHaveBeenCalledWith({
			id: 3,
			message:
				"等級「技能1級」を保存しました。この等級で作成済みの評価シート 6 枚は、作成時の共通目標のままです。",
		});
	});

	it("only says it was saved when the common goals did not change", async () => {
		const { saveGrade } = setup();
		const out = output<{ id: number; message: string }>();
		await saveGrade.execute({ name: "技能Ⅰ級", itemSetId: 2, shown: grade }, out);
		expect(out.present).toHaveBeenCalledWith({ id: 3, message: "等級「技能Ⅰ級」を保存しました。" });
	});

	it("stops an invalid grade before writing", async () => {
		const { repository, saveGrade } = setup();
		expect(await saveGrade.execute({ name: "", itemSetId: 2, shown: null }, output())).toEqual({
			ok: false,
			error: { kind: "nameInvalid" },
		});
		expect(repository.saveGrade).not.toHaveBeenCalled();
	});

	it("passes a database refusal through without claiming success", async () => {
		const { repository, saveGrade } = setup();
		repository.saveGrade.mockRejectedValue(new Error("等級「総合1級」はすでにあります。"));
		const out = output();
		await expect(
			saveGrade.execute({ name: "総合1級", itemSetId: 2, shown: null }, out),
		).rejects.toThrow("すでにあります");
		expect(out.present).not.toHaveBeenCalled();
	});
});

describe("deleting a grade", () => {
	it("deletes a grade nobody holds and no sheet was made with", async () => {
		const { repository, deleteGrade } = setup();
		const out = output<{ message: string }>();
		const unused = { ...grade, sheetCount: 0 };
		await deleteGrade.execute({ grade: unused }, out);
		expect(repository.deleteGrade).toHaveBeenCalledWith(unused);
		expect(out.present).toHaveBeenCalledWith({ message: "等級「技能1級」を削除しました。" });
	});

	it("refuses a grade in use before writing", async () => {
		const { repository, deleteGrade } = setup();
		expect(await deleteGrade.execute({ grade }, output())).toEqual({
			ok: false,
			error: { kind: "gradeInUse", employees: 0, sheets: 6 },
		});
		expect(repository.deleteGrade).not.toHaveBeenCalled();
	});
});

describe("saving common goals", () => {
	it("adds a set", async () => {
		const { repository, saveSet } = setup();
		repository.saveCommonGoalSet.mockResolvedValue(7);
		const out = output<{ id: number; message: string }>();
		await saveSet.execute(
			{ name: "管理職", items: [{ ...set.items[0], id: null }], shown: null },
			out,
		);
		expect(out.present).toHaveBeenCalledWith({
			id: 7,
			message: "共通目標「管理職」を追加しました。",
		});
	});

	it("says a set that sheets use was saved as a new version and the sheets keep the old one", async () => {
		const { repository, saveSet } = setup();
		repository.saveCommonGoalSet.mockResolvedValue(8);
		const out = output<{ id: number; message: string }>();
		await saveSet.execute(
			{ name: "一般", items: [{ ...set.items[0], weight: 3 }], shown: set },
			out,
		);
		expect(out.present).toHaveBeenCalledWith({
			id: 8,
			message:
				"共通目標「一般」を新しい版として保存しました。作成済みの評価シート 4 枚は前の版のままです。これから作るシートから新しい版になります。",
		});
	});

	it("saves a set in place", async () => {
		const { saveSet } = setup();
		const out = output<{ id: number; message: string }>();
		await saveSet.execute({ name: "一般(改)", items: set.items, shown: set }, out);
		expect(out.present).toHaveBeenCalledWith({
			id: 2,
			message: "共通目標「一般(改)」を保存しました。",
		});
	});

	it("stops invalid items before writing", async () => {
		const { repository, saveSet } = setup();
		expect(
			await saveSet.execute(
				{ name: "一般", items: [{ ...set.items[0], weight: 0 }], shown: set },
				output(),
			),
		).toEqual({ ok: false, error: { kind: "weightInvalid", row: 1 } });
		expect(repository.saveCommonGoalSet).not.toHaveBeenCalled();
	});
});

describe("deleting common goals", () => {
	it("deletes a set no grade and no sheet uses", async () => {
		const { repository, deleteSet } = setup();
		const out = output<{ message: string }>();
		const unused = { ...set, sheetCount: 0 };
		await deleteSet.execute({ set: unused, grades: [] }, out);
		expect(repository.deleteCommonGoalSet).toHaveBeenCalledWith(unused);
		expect(out.present).toHaveBeenCalledWith({ message: "共通目標「一般」を削除しました。" });
	});

	it("refuses a set in use before writing", async () => {
		const { repository, deleteSet } = setup();
		expect(
			await deleteSet.execute({ set: { ...set, sheetCount: 0 }, grades: [grade] }, output()),
		).toEqual({
			ok: false,
			error: { kind: "setInUse", grades: ["技能1級"], sheets: 0 },
		});
		expect(repository.deleteCommonGoalSet).not.toHaveBeenCalled();
	});
});

describe("error messages", () => {
	it.each([
		[{ kind: "forbidden" }, "等級と共通目標のマスタは Admin のみ利用できます。"],
		[{ kind: "nameInvalid" }, "等級名を 50 文字以内で入力してください。"],
		[{ kind: "itemSetRequired" }, "この等級の共通目標を選んでください。"],
		[
			{ kind: "gradeInUse", employees: 2, sheets: 0 },
			"この等級の社員が 2 人います。先に社員マスタで等級を変えてください。",
		],
		[
			{ kind: "gradeInUse", employees: 0, sheets: 3 },
			"この等級で作られた評価シートが 3 枚あります。シートの記録に使うため削除できません。",
		],
		[{ kind: "setNameInvalid" }, "共通目標の名前を 50 文字以内で入力してください。"],
		[{ kind: "itemsRequired" }, "共通目標の項目を 1 件以上入力してください。"],
		[{ kind: "tooManyItems" }, "共通目標の項目は 30 件までです。"],
		[{ kind: "titleInvalid", row: 2 }, "2 行目: 項目名を 100 文字以内で入力してください。"],
		[{ kind: "descriptionTooLong", row: 1 }, "1 行目: 説明は 1000 文字以内で入力してください。"],
		[{ kind: "weightInvalid", row: 3 }, "3 行目: 重みは 1〜10 の整数で入力してください。"],
		[{ kind: "duplicateTitle", title: "品質" }, "項目名「品質」が重複しています。"],
		[
			{ kind: "setInUse", grades: ["技能1級", "技能2級"], sheets: 0 },
			"この共通目標は等級(技能1級・技能2級)が使っています。先に等級の共通目標を変えてください。",
		],
		[
			{ kind: "setInUse", grades: [], sheets: 4 },
			"この共通目標で作られた評価シートが 4 枚あります。シートの記録に使うため削除できません。",
		],
	] as const)("describes %o", (error, message) => {
		expect(describeGradeMasterError(error)).toBe(message);
	});
});
