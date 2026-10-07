import type { ApprovalRelationDto } from "../../application/dtos/EmployeeMasterDto";

/** ひとりの一次評価者と、その人が一次評価をする社員。 */
export interface StructurePrimary {
	key: string;
	name: string;
	/** 一次評価者がまだ決まっていない社員のグループ。 */
	unset: boolean;
	members: ApprovalRelationDto[];
}

/** 最終的に評価を確定する人(二次評価者)ごとのまとまり。 */
export interface StructureFinal {
	key: string;
	/** secondary: 二次評価者がいる / none: 「なし」と明示(一次評価が最終) / unset: まだ決まっていない */
	kind: "secondary" | "none" | "unset";
	name: string;
	total: number;
	primaries: StructurePrimary[];
}

const KIND_ORDER: Record<StructureFinal["kind"], number> = { secondary: 0, none: 1, unset: 2 };
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "ja");

/**
 * 評価の流れ(社員 → 一次評価者 → 二次評価者)を、評価を確定する人からたどれる3段にまとめる。
 * 木ではなくグループなので、社員が増えても横には広がらず、評価者どうしの関係が循環していても崩れない。
 * 評価者が決まっていない社員は「未設定」のグループに集まり、設定の漏れがそのまま見える。
 */
export function buildEvaluationStructure(relations: ApprovalRelationDto[]): StructureFinal[] {
	const finals = new Map<string, StructureFinal & { byPrimary: Map<string, StructurePrimary> }>();
	for (const relation of relations) {
		const kind: StructureFinal["kind"] =
			relation.secondaryEvaluatorId != null
				? "secondary"
				: relation.noSecondaryEvaluator
					? "none"
					: "unset";
		const finalKey = kind === "secondary" ? `id:${relation.secondaryEvaluatorId}` : kind;
		let final = finals.get(finalKey);
		if (!final) {
			final = {
				key: finalKey,
				kind,
				name:
					kind === "secondary"
						? relation.secondaryEvaluatorName
						: kind === "none"
							? "二次評価者なし"
							: "二次評価者 未設定",
				total: 0,
				primaries: [],
				byPrimary: new Map(),
			};
			finals.set(finalKey, final);
		}
		const unset = relation.primaryEvaluatorId == null;
		const primaryKey = unset ? "unset" : `id:${relation.primaryEvaluatorId}`;
		let primary = final.byPrimary.get(primaryKey);
		if (!primary) {
			primary = {
				key: primaryKey,
				name: unset ? "一次評価者 未設定" : relation.primaryEvaluatorName,
				unset,
				members: [],
			};
			final.byPrimary.set(primaryKey, primary);
			final.primaries.push(primary);
		}
		primary.members.push(relation);
		final.total += 1;
	}

	return [...finals.values()]
		.map(({ byPrimary: _, ...final }) => ({
			...final,
			primaries: final.primaries
				.map((primary) => ({
					...primary,
					members: [...primary.members].sort((a, b) =>
						a.employeeNo.localeCompare(b.employeeNo, "ja"),
					),
				}))
				.sort((a, b) => Number(a.unset) - Number(b.unset) || byName(a, b)),
		}))
		.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.total - a.total || byName(a, b));
}
