import { supabase } from "../../../utils/supabase";

export interface EvaluationPeriod {
	id: number;
	period_name: string;
	start_date: string;
	end_date: string;
	is_active: boolean;
}

export interface EvaluatorNames {
	primaryEvaluator: string;
	secondaryEvaluator: string;
}

export const fetchDistinctEvaluationPeriods = async (): Promise<EvaluationPeriod[]> => {
	const { data, error } = await supabase
		.from("evaluation_periods")
		.select("id, period_name, start_date, end_date, is_active")
		.order("period_name", { ascending: true });

	if (error) {
		console.error("Error fetching evaluation periods:", error.message);
		throw error;
	}

	const rows = (data as EvaluationPeriod[]) ?? [];
	const uniquePeriods = new Map<string, EvaluationPeriod>();

	for (const row of rows) {
		if (!uniquePeriods.has(row.period_name)) {
			uniquePeriods.set(row.period_name, row);
		}
	}

	return Array.from(uniquePeriods.values());
};

export const fetchEvaluatorNames = async (
	primaryEvaluatorId: number | null,
	secondaryEvaluatorId: number | null,
): Promise<EvaluatorNames> => {
	if (!primaryEvaluatorId && !secondaryEvaluatorId) {
		return {
			primaryEvaluator: "未設定",
			secondaryEvaluator: "未設定",
		};
	}

	const ids = [primaryEvaluatorId, secondaryEvaluatorId].filter((id): id is number => Boolean(id));
	const { data, error } = await supabase.from("employees").select("id, name").in("id", ids);

	if (error) {
		console.error("Error fetching evaluator names:", error.message);
		return {
			primaryEvaluator: "未設定",
			secondaryEvaluator: "未設定",
		};
	}

	const employees = (data ?? []) as { id: number; name: string }[];
	const names = new Map<number, string>(employees.map((employee) => [employee.id, employee.name]));

	return {
		primaryEvaluator: names.get(primaryEvaluatorId ?? 0) ?? "未設定",
		secondaryEvaluator: names.get(secondaryEvaluatorId ?? 0) ?? "未設定",
	};
};
