import { EvaluationPeriod } from "../../domain/entities/EvaluationPeriod";
import type { EvaluationPeriodRepository } from "../../domain/repositories/EvaluationPeriodRepository";
import { supabase } from "../db/supabase";

export class SupabaseEvaluationPeriodRepository implements EvaluationPeriodRepository {
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
