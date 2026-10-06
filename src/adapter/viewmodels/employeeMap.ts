import { hierarchy, tree } from "d3-hierarchy";
import type { EmployeeMapPersonDto } from "../../application/dtos/EmployeeMapDto";

export type MapMode = "primary" | "secondary";
export interface MapBranch {
	person: EmployeeMapPersonDto | null;
	children: MapBranch[];
}
export function evaluatorId(person: EmployeeMapPersonDto, mode: MapMode): number | null {
	return mode === "primary"
		? person.primaryEvaluatorId
		: (person.secondaryEvaluatorId ??
				(person.noSecondaryEvaluator ? person.primaryEvaluatorId : null));
}

/** A forest preserves every employee, including disconnected or invalid relationships. */
export function buildEmployeeForest(people: EmployeeMapPersonDto[], mode: MapMode) {
	const byId = new Map(people.map((person) => [person.id, person]));
	const parents = new Map<number, number | null>();
	const issues = new Map<number, string>();
	const sorted = [...people].sort((a, b) => a.employeeNo.localeCompare(b.employeeNo, "ja"));
	for (const person of sorted) {
		const parent = evaluatorId(person, mode);
		if (parent === person.id) {
			issues.set(person.id, "自分自身が評価者に設定されています");
			parents.set(person.id, null);
		} else if (parent !== null && !byId.has(parent)) {
			issues.set(person.id, "評価者が社員マスタに見つかりません");
			parents.set(person.id, null);
		} else {
			parents.set(person.id, parent);
		}
	}
	const done = new Set<number>();
	for (const person of sorted) {
		const path: number[] = [];
		const positions = new Map<number, number>();
		let id: number | null = person.id;
		while (id !== null && !done.has(id)) {
			const index = positions.get(id);
			if (index !== undefined) {
				const cycle = path.slice(index);
				for (const member of cycle) {
					issues.set(member, "評価者の関係が循環しています");
				}
				parents.set(Math.min(...cycle), null);
				break;
			}
			positions.set(id, path.length);
			path.push(id);
			id = parents.get(id) ?? null;
		}
		for (const member of path) {
			done.add(member);
		}
	}
	const branches = new Map(
		sorted.map((person) => [person.id, { person, children: [] } as MapBranch]),
	);
	const root: MapBranch = { person: null, children: [] };
	for (const person of sorted) {
		const branch = branches.get(person.id);
		if (!branch) {
			continue;
		}
		const parent = parents.get(person.id);
		(parent == null ? root : (branches.get(parent) ?? root)).children.push(branch);
	}
	return { root, branches, parents, issues, byId };
}

export function layoutEmployeeForest(root: MapBranch, collapsed: Set<number>) {
	const layout = tree<MapBranch>().nodeSize([220, 140])(
		hierarchy(root, (branch) =>
			branch.person && collapsed.has(branch.person.id) ? [] : branch.children,
		),
	);
	const nodes = layout.descendants().filter((node) => node.data.person !== null);
	const min = Math.min(0, ...nodes.map((node) => node.x));
	const max = Math.max(0, ...nodes.map((node) => node.x));
	const positions = nodes.flatMap((node) =>
		node.data.person
			? [
					{
						person: node.data.person,
						x: node.x - min + 30,
						y: node.y - 100,
						children: node.data.children.length,
					},
				]
			: [],
	);
	const byId = new Map(positions.map((node) => [node.person.id, node]));
	return {
		nodes: positions,
		links: layout.links().flatMap((link) => {
			const source = link.source.data.person && byId.get(link.source.data.person.id);
			const target = link.target.data.person && byId.get(link.target.data.person.id);
			return source && target ? [{ source, target }] : [];
		}),
		width: Math.max(640, max - min + 256),
		height: Math.max(300, ...positions.map((node) => node.y + 140)),
	};
}
