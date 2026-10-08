import { EvaluationPeriod } from "../../domain/entities/EvaluationPeriod";
import type {
	EvaluationPeriodInput,
	EvaluationPeriodRepository,
} from "../../domain/repositories/EvaluationPeriodRepository";
import type { EvaluationStatusValue } from "../../domain/valueObjects/EvaluationStatus";
import { supabase } from "../db/supabase";

const toRow = (input: EvaluationPeriodInput) => ({
	period_name: input.periodName,
	start_date: input.startDate,
	end_date: input.endDate,
});

/** RLSで拒否された変更はエラーにならず0件で返るため、変更できた行があることも確かめる。 */
function changed(result: { data: unknown[] | null; error: unknown }, operation: string): boolean {
	if (result.error) {
		console.error(`Error ${operation} evaluation period:`, result.error);
	}
	return !result.error && (result.data?.length ?? 0) > 0;
}

export class SupabaseEvaluationPeriodRepository implements EvaluationPeriodRepository {
	async create(input: EvaluationPeriodInput): Promise<boolean> {
		return changed(
			await supabase.from("evaluation_periods").insert(toRow(input)).select("id"),
			"creating",
		);
	}

	async update(periodId: number, input: EvaluationPeriodInput): Promise<boolean> {
		return changed(
			await supabase
				.from("evaluation_periods")
				.update(toRow(input))
				.eq("id", periodId)
				.select("id"),
			"updating",
		);
	}

	async delete(periodId: number): Promise<boolean> {
		return changed(
			await supabase.from("evaluation_periods").delete().eq("id", periodId).select("id"),
			"deleting",
		);
	}

	async activate(periodId: number): Promise<boolean> {
		// is_active はクライアントから直接更新できない。Admin の確認、未確定のシートの確認、
		// 実施中の期間の入れ替えを、DB関数がひとつのトランザクションで行う
		const { data, error } = await supabase.rpc("activate_evaluation_period", {
			p_period_id: periodId,
		});
		if (error) {
			console.error("Error activating evaluation period:", error);
			return false;
		}
		return data === true;
	}

	async countSheetsByStatus(
		periodId: number,
	): Promise<Partial<Record<EvaluationStatusValue, number>>> {
		const { data, error } = await supabase.rpc("get_evaluation_period_sheet_counts", {
			p_period_id: periodId,
		});
		if (error) {
			throw error;
		}
		return (data ?? {}) as Partial<Record<EvaluationStatusValue, number>>;
	}

	async findDistinctPeriods(): Promise<EvaluationPeriod[]> {
		const { data, error } = await supabase
			.from("evaluation_periods")
			.select("id, period_name, start_date, end_date, is_active")
			.order("period_name", { ascending: true });

		if (error) {
			throw error;
		}

		const rows = (data ?? []) as Array<{
			id: number;
			period_name: string;
			start_date: string;
			end_date: string;
			is_active: boolean;
		}>;
		const uniquePeriods = new Map<string, EvaluationPeriod>();
		for (const row of rows) {
			if (!uniquePeriods.has(row.period_name)) {
				uniquePeriods.set(
					row.period_name,
					new EvaluationPeriod(
						row.id,
						row.period_name,
						row.start_date,
						row.end_date,
						row.is_active,
					),
				);
			}
		}

		return Array.from(uniquePeriods.values());
	}

	async findById(periodId: number): Promise<EvaluationPeriod | null> {
		const { data, error } = await supabase
			.from("evaluation_periods")
			.select("id, period_name, start_date, end_date, is_active")
			.eq("id", periodId)
			.maybeSingle();

		if (error || !data) {
			return null;
		}

		const row = data as {
			id: number;
			period_name: string;
			start_date: string;
			end_date: string;
			is_active: boolean;
		};

		return new EvaluationPeriod(
			row.id,
			row.period_name,
			row.start_date,
			row.end_date,
			row.is_active,
		);
	}
}
