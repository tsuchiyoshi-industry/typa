import type {
	CommonGoal,
	CommonGoalSet,
	CommonGoalSetChange,
	GradeChange,
	GradeEntry,
	GradeMaster,
} from "../../domain/entities/GradeMaster";
import type { GradeMasterRepository } from "../../domain/repositories/GradeMasterRepository";
import { supabase } from "../db/supabase";

const isInt = (value: unknown): value is number => Number.isSafeInteger(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isGrade = (row: GradeEntry) =>
	isInt(row?.id) &&
	isText(row.name) &&
	(row.itemSetId === null || isInt(row.itemSetId)) &&
	isInt(row.employeeCount) &&
	isInt(row.sheetCount);
const isItem = (row: CommonGoal) =>
	isInt(row?.id) && isText(row.title) && isText(row.description) && isInt(row.weight);
const isSet = (row: CommonGoalSet) =>
	isInt(row?.id) &&
	isText(row.name) &&
	isInt(row.sheetCount) &&
	Array.isArray(row.items) &&
	row.items.every(isItem);

/** DB 関数 get_grade_master と、等級・共通目標の保存・削除の DB 関数(どれも Admin だけ・監査つき)。 */
export class SupabaseGradeMasterRepository implements GradeMasterRepository {
	async load(): Promise<GradeMaster> {
		const { data, error } = await supabase.rpc("get_grade_master");
		if (error) {
			throw error;
		}
		const master = data as GradeMaster | null;
		if (
			!Array.isArray(master?.grades) ||
			!Array.isArray(master.itemSets) ||
			!master.grades.every(isGrade) ||
			!master.itemSets.every(isSet)
		) {
			throw new Error("等級と共通目標を読み込めませんでした。再読み込みしてください。");
		}
		return master;
	}

	async saveGrade(change: GradeChange): Promise<number> {
		return savedId(
			await supabase.rpc("save_employee_grade", {
				p_id: change.id,
				p_name: change.name,
				p_item_set_id: change.itemSetId,
				p_expected_name: change.expected?.name ?? null,
				p_expected_item_set_id: change.expected?.itemSetId ?? null,
			}),
		);
	}

	async deleteGrade(shown: GradeEntry): Promise<void> {
		const { error } = await supabase.rpc("delete_employee_grade", {
			p_id: shown.id,
			p_expected_name: shown.name,
		});
		if (error) {
			throw error;
		}
	}

	async saveCommonGoalSet(change: CommonGoalSetChange): Promise<number> {
		return savedId(
			await supabase.rpc("save_common_evaluation_item_set", {
				p_id: change.id,
				p_name: change.name,
				p_items: change.items,
				p_expected: change.expected,
			}),
		);
	}

	async deleteCommonGoalSet(shown: CommonGoalSet): Promise<void> {
		const { error } = await supabase.rpc("delete_common_evaluation_item_set", {
			p_id: shown.id,
			p_expected_name: shown.name,
		});
		if (error) {
			throw error;
		}
	}
}

function savedId({ data, error }: { data: unknown; error: unknown }): number {
	if (error) {
		throw error;
	}
	if (!isInt(data)) {
		throw new Error("保存できたか確かめられませんでした。再読み込みしてください。");
	}
	return data;
}
