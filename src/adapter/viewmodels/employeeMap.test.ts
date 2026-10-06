import { describe, expect, it } from "vitest";
import type { EmployeeMapPersonDto } from "../../application/dtos/EmployeeMapDto";
import { buildEmployeeForest, layoutEmployeeForest } from "./employeeMap";

function mapPerson(
	id: number,
	primaryEvaluatorId: number | null = null,
	secondaryEvaluatorId: number | null = null,
): EmployeeMapPersonDto {
	return {
		id,
		name: `社員${id}`,
		employeeNo: `TEST${id}`,
		gradeName: "G1",
		careerCourse: "技術",
		roleName: "Employee",
		primaryEvaluatorId,
		secondaryEvaluatorId,
		noSecondaryEvaluator: false,
		registered: true,
	};
}
describe("employee map", () => {
	it("lays out evaluator above their employees and switches secondary relationships", () => {
		const people = [mapPerson(1), mapPerson(2, 1), mapPerson(3, 2, 1)];
		const first = layoutEmployeeForest(buildEmployeeForest(people, "primary").root, new Set());
		expect(first.links.map((link) => [link.source.person.id, link.target.person.id])).toEqual([
			[1, 2],
			[2, 3],
		]);
		expect(first.links.every((link) => link.source.y < link.target.y)).toBe(true);
		const second = buildEmployeeForest(people, "secondary");
		expect(second.parents.get(3)).toBe(1);
		expect(second.parents.get(2)).toBeNull();
	});
	it("uses primary as final evaluator only when no secondary is explicitly set", () => {
		const person = { ...mapPerson(2, 1), noSecondaryEvaluator: true };
		expect(buildEmployeeForest([mapPerson(1), person], "secondary").parents.get(2)).toBe(1);
	});
	it("preserves every employee with missing, self-referencing and cyclic evaluators", () => {
		const people = [
			mapPerson(1, 2),
			mapPerson(2, 1),
			mapPerson(3, 2),
			mapPerson(4, 99),
			mapPerson(5, 5),
			mapPerson(6),
		];
		const forest = buildEmployeeForest(people, "primary");
		const layout = layoutEmployeeForest(forest.root, new Set());
		expect(layout.nodes.map((node) => node.person.id).sort()).toEqual([1, 2, 3, 4, 5, 6]);
		expect([...forest.issues.keys()].sort()).toEqual([1, 2, 4, 5]);
		expect(forest.parents.get(1)).toBeNull();
		expect(buildEmployeeForest([...people].reverse(), "primary").parents).toEqual(forest.parents);
	});
	it("collapses descendants while retaining their data", () => {
		const forest = buildEmployeeForest([mapPerson(1), mapPerson(2, 1), mapPerson(3, 2)], "primary");
		expect(
			layoutEmployeeForest(forest.root, new Set([1])).nodes.map((node) => node.person.id),
		).toEqual([1]);
		expect(forest.byId.size).toBe(3);
	});
	it("supports empty data and a deep hierarchy", () => {
		const empty = layoutEmployeeForest(buildEmployeeForest([], "primary").root, new Set());
		expect(empty.nodes).toEqual([]);
		expect(Number.isFinite(empty.width + empty.height)).toBe(true);
		const people = Array.from({ length: 1000 }, (_, i) => mapPerson(i + 1, i === 0 ? null : i));
		expect(
			layoutEmployeeForest(buildEmployeeForest(people, "primary").root, new Set()).nodes,
		).toHaveLength(1000);
	});
});
