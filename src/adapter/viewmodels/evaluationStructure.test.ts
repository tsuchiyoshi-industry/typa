import { describe, expect, it } from "vitest";
import type { ApprovalRelationDto } from "../../application/dtos/EmployeeMasterDto";
import { buildEvaluationStructure } from "./evaluationStructure";

const names: Record<number, string> = { 10: "部長", 11: "課長A", 12: "課長B", 20: "役員" };
const person = (
	id: number,
	primary: number | null,
	secondary: number | null,
	noSecondary = false,
): ApprovalRelationDto => ({
	employeeId: id,
	employeeNo: `E${String(id).padStart(3, "0")}`,
	name: `社員${id}`,
	careerCourse: "総合職",
	roleName: null,
	gradeId: 1,
	gradeName: "G1",
	primaryEvaluatorId: primary,
	primaryEvaluatorName: primary == null ? "未設定" : names[primary],
	secondaryEvaluatorId: secondary,
	secondaryEvaluatorName: secondary == null ? (noSecondary ? "なし" : "未設定") : names[secondary],
	noSecondaryEvaluator: noSecondary,
	registered: true,
});

describe("evaluation structure", () => {
	it("groups employees under their primary evaluator, under whoever finalizes the evaluation", () => {
		const structure = buildEvaluationStructure([
			person(3, 12, 10),
			person(1, 11, 10),
			person(2, 11, 10),
			person(4, 11, 20),
		]);
		expect(
			structure.map((final) => [
				final.name,
				final.total,
				final.primaries.map((primary) => [
					primary.name,
					primary.members.map((member) => member.employeeNo),
				]),
			]),
		).toEqual([
			// 担当の多い二次評価者が先。その中は一次評価者の名前順、社員は社員番号順
			[
				"部長",
				3,
				[
					["課長A", ["E001", "E002"]],
					["課長B", ["E003"]],
				],
			],
			["役員", 1, [["課長A", ["E004"]]]],
		]);
	});
	it("separates 'no secondary evaluator' from 'not assigned yet', and shows missing primaries", () => {
		const structure = buildEvaluationStructure([
			person(1, null, null),
			person(2, 11, null),
			person(3, 11, null, true),
			person(4, null, 10),
			person(5, 11, 10),
		]);
		expect(structure.map((final) => [final.kind, final.name, final.total])).toEqual([
			["secondary", "部長", 2],
			["none", "二次評価者なし", 1],
			["unset", "二次評価者 未設定", 2],
		]);
		// 一次評価者が決まっていない社員は、各まとまりの最後に集まる
		expect(structure[0].primaries.map((primary) => [primary.name, primary.unset])).toEqual([
			["課長A", false],
			["一次評価者 未設定", true],
		]);
		expect(structure[2].primaries.map((primary) => primary.name)).toEqual([
			"課長A",
			"一次評価者 未設定",
		]);
	});
	it("stays flat when evaluators evaluate each other, and counts every employee exactly once", () => {
		// 11 と 12 が互いの一次評価者。木にすると循環するが、3段のグループでは問題にならない
		const relations = [person(11, 12, 10), person(12, 11, 10), person(10, null, null, true)];
		const structure = buildEvaluationStructure(relations);
		expect(structure.reduce((sum, final) => sum + final.total, 0)).toBe(relations.length);
		expect(
			structure.flatMap((final) => final.primaries.flatMap((primary) => primary.members)),
		).toHaveLength(relations.length);
		expect(buildEvaluationStructure([])).toEqual([]);
	});
});
