import { supabase } from "../../../utils/supabase";
import type { Employee } from "./evaluationSheet";

/**
 * ログイン中のユーザーに紐づく employees.id を返す。
 * 未ログインまたは社員レコードが存在しない場合は null を返す。
 */
async function getCurrentEmployeeId(): Promise<number | null> {
	const {
		data: { user },
	} = await supabase.auth.getUser();

	if (!user) {
		return null;
	}

	const { data, error } = await supabase
		.from("employees")
		.select("id")
		.eq("user_id", user.id)
		.maybeSingle();

	if (error || !data) {
		return null;
	}

	return (data as { id: number }).id;
}

/**
 * ログイン中のユーザーが、指定した従業員の一次評価者かどうかを返す。
 */
export async function isPrimaryEvaluator(employee: Employee): Promise<boolean> {
	if (employee.primary_evaluator_id == null) {
		return false;
	}
	const currentId = await getCurrentEmployeeId();
	return currentId !== null && currentId === employee.primary_evaluator_id;
}

/**
 * ログイン中のユーザーが、指定した従業員の二次評価者かどうかを返す。
 */
export async function isSecondaryEvaluator(employee: Employee): Promise<boolean> {
	if (employee.secondary_evaluator_id == null) {
		return false;
	}
	const currentId = await getCurrentEmployeeId();
	return currentId !== null && currentId === employee.secondary_evaluator_id;
}
