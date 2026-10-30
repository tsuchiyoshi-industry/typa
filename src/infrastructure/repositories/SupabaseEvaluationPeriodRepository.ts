import { EvaluationPeriod } from "../../domain/entities/EvaluationPeriod";
import type { EvaluationPeriodPlan } from "../../domain/entities/EvaluationPeriodPlan";
import type { EvaluationPeriodRepository } from "../../domain/repositories/EvaluationPeriodRepository";
import type { EvaluationStatusValue } from "../../domain/valueObjects/EvaluationStatus";
import { SheetCountsByStatus } from "../../domain/valueObjects/SheetCountsByStatus";
import { supabase } from "../db/supabase";

const COLUMNS =
	"id, period_name, term_name, division, part, start_date, end_date, is_active, closed_at, allow_unfinalized_close";

interface PeriodRow {
	id: number;
	term_name: string;
	division: string;
	part: number;
	start_date: string;
	end_date: string;
	is_active: boolean;
	closed_at: string | null;
	allow_unfinalized_close: boolean;
}

/** 変えられる列。どの区切りか(division / part)は、作った後は変えない(DB も更新を許さない)。 */
const toUpdateRow = (plan: EvaluationPeriodPlan) => ({
	period_name: plan.periodName,
	term_name: plan.term.toString(),
	start_date: plan.range.start.toString(),
	end_date: plan.range.end.toString(),
	allow_unfinalized_close: plan.allowUnfinalizedClose,
});

const toInsertRow = (plan: EvaluationPeriodPlan) => ({
	...toUpdateRow(plan),
	division: plan.part.division.toString(),
	part: plan.part.number,
});

const toPeriod = (row: PeriodRow) =>
	EvaluationPeriod.restore({
		id: row.id,
		termName: row.term_name,
		division: row.division,
		part: row.part,
		startDate: row.start_date,
		endDate: row.end_date,
		isActive: row.is_active,
		isClosed: row.closed_at !== null,
		allowUnfinalizedClose: row.allow_unfinalized_close,
	});

/** RLSで拒否された変更はエラーにならず0件で返るため、変更できた行があることも確かめる。 */
function changed(result: { data: unknown[] | null; error: unknown }, operation: string): boolean {
	if (result.error) {
		console.error(`Error ${operation} evaluation period:`, result.error);
	}
	return !result.error && (result.data?.length ?? 0) > 0;
}

export class SupabaseEvaluationPeriodRepository implements EvaluationPeriodRepository {
	async create(plans: EvaluationPeriodPlan[]): Promise<boolean> {
		// 1回の insert は1文なので、途中で拒否されたら1件も入らない
		return changed(
			await supabase.from("evaluation_periods").insert(plans.map(toInsertRow)).select("id"),
			"creating",
		);
	}

	async update(periodId: number, plan: EvaluationPeriodPlan): Promise<boolean> {
		return changed(
			await supabase
				.from("evaluation_periods")
				.update(toUpdateRow(plan))
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

	async countSheetsByStatus(periodId: number): Promise<SheetCountsByStatus> {
		const { data, error } = await supabase.rpc("get_evaluation_period_sheet_counts", {
			p_period_id: periodId,
		});
		if (error) {
			throw error;
		}
		return SheetCountsByStatus.from((data ?? {}) as Partial<Record<EvaluationStatusValue, number>>);
	}

	async findDistinctPeriods(): Promise<EvaluationPeriod[]> {
		const { data, error } = await supabase
			.from("evaluation_periods")
			.select(COLUMNS)
			.order("start_date", { ascending: false });
		if (error) {
			throw new Error(error.message);
		}
		return ((data ?? []) as PeriodRow[]).map(toPeriod);
	}

	async findById(periodId: number): Promise<EvaluationPeriod | null> {
		const { data, error } = await supabase
			.from("evaluation_periods")
			.select(COLUMNS)
			.eq("id", periodId)
			.maybeSingle();
		// 読めなかったことを「その評価期間は無い」と見せない
		if (error) {
			throw new Error(error.message);
		}
		return data ? toPeriod(data as PeriodRow) : null;
	}
}
