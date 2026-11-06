import { expect, it, vi } from "vitest";
import {
	DeleteCommonGoalSetInteractor,
	DeleteEmployeeGradeInteractor,
	LoadGradeMasterInteractor,
	SaveCommonGoalSetInteractor,
	SaveEmployeeGradeInteractor,
} from "../../application/usecases/GradeMasterInteractors";
import type { CommonGoalSet, GradeEntry } from "../../domain/entities/GradeMaster";
import type { GradeMasterRepository } from "../../domain/repositories/GradeMasterRepository";
import { masterRepository, profile } from "../../test/fixtures";
import { GradeMasterController } from "./GradeMasterController";

const grade: GradeEntry = { id: 3, name: "技能1級", itemSetId: 2, employeeCount: 0, sheetCount: 0 };
const set: CommonGoalSet = {
	id: 2,
	name: "一般",
	sheetCount: 4,
	items: [{ id: 10, title: "協調性", description: "説明", weight: 2 }],
};
const setup = (role = "Admin") => {
	const employees = masterRepository();
	employees.findCurrentEmployeeProfile.mockResolvedValue(profile(role));
	const repository = {
		load: vi.fn().mockResolvedValue({ grades: [grade], itemSets: [set] }),
		saveGrade: vi.fn().mockResolvedValue(3),
		deleteGrade: vi.fn().mockResolvedValue(undefined),
		saveCommonGoalSet: vi.fn().mockResolvedValue(2),
		deleteCommonGoalSet: vi.fn().mockResolvedValue(undefined),
	} satisfies GradeMasterRepository;
	const controller = new GradeMasterController(
		new LoadGradeMasterInteractor(repository, employees),
		new SaveEmployeeGradeInteractor(repository, employees),
		new DeleteEmployeeGradeInteractor(repository, employees),
		new SaveCommonGoalSetInteractor(repository, employees),
		new DeleteCommonGoalSetInteractor(repository, employees),
	);
	return { controller, repository };
};

it("loads the master for an Admin", async () => {
	expect(await setup().controller.load()).toEqual({ grades: [grade], itemSets: [set] });
});

it("refuses to load for anyone else, without reading", async () => {
	const { controller, repository } = setup("Reviewer");
	await expect(controller.load()).rejects.toThrow("Admin のみ利用できます");
	expect(repository.load).not.toHaveBeenCalled();
});

it("reports a saved grade with its id", async () => {
	expect(
		await setup().controller.saveGrade({ name: "技能1級", itemSetId: 2, shown: grade }),
	).toEqual({
		success: true,
		id: 3,
		message: "等級「技能1級」を保存しました。",
	});
});

it("reports a rule the input breaks", async () => {
	expect(await setup().controller.saveGrade({ name: "", itemSetId: 2, shown: null })).toEqual({
		success: false,
		message: "等級名を 50 文字以内で入力してください。",
	});
});

it("reports a database refusal as it was given", async () => {
	const { controller, repository } = setup();
	repository.saveCommonGoalSet.mockRejectedValue(
		new Error("共通目標がほかの操作で変わりました。再読み込みしてから操作してください。"),
	);
	expect(
		await controller.saveCommonGoalSet({ name: "一般", items: set.items, shown: set }),
	).toEqual({
		success: false,
		message: "共通目標がほかの操作で変わりました。再読み込みしてから操作してください。",
	});
});

it("reports a failure that is not an Error with a fixed message", async () => {
	const { controller, repository } = setup();
	repository.deleteGrade.mockRejectedValue("offline");
	expect(await controller.deleteGrade(grade)).toEqual({
		success: false,
		message: "等級を削除できませんでした。",
	});
});

it("deletes a set and reports it", async () => {
	const { controller, repository } = setup();
	const unused = { ...set, sheetCount: 0 };
	expect(await controller.deleteCommonGoalSet(unused, [])).toEqual({
		success: true,
		message: "共通目標「一般」を削除しました。",
	});
	expect(repository.deleteCommonGoalSet).toHaveBeenCalledWith(unused);
});

it("tells the screen whether saving will make a new version", () => {
	const { controller } = setup();
	expect(controller.makesNewVersion({ name: "一般", items: set.items, shown: set })).toBe(false);
	expect(
		controller.makesNewVersion({
			name: "一般",
			items: [{ ...set.items[0], weight: 1 }],
			shown: set,
		}),
	).toBe(true);
	// 入力が正しくないうちは、保存できないので新版にもならない
	expect(controller.makesNewVersion({ name: "", items: [], shown: set })).toBe(false);
});
