import { supabase } from "../../../utils/supabase";

export interface EmployeeGrade {
	id: number;
	grade_name: string;
}

/**
 * 等級IDから等級名を取得する
 * @param gradeId - 等級ID
 * @returns 等級名（取得できない場合は "未設定"）
 */
export async function fetchGradeName(gradeId: number | null): Promise<string> {
	if (gradeId == null) {
		return "未設定";
	}

	const { data, error } = await supabase
		.from("employee_grades")
		.select("grade_name")
		.eq("id", gradeId)
		.single();

	if (error || !data) {
		console.error("Failed to fetch grade name:", error);
		return "未設定";
	}

	return data.grade_name;
}

/**
 * 全ての等級を取得する
 * @returns 等級の配列
 */
export async function fetchAllGrades(): Promise<EmployeeGrade[]> {
	const { data, error } = await supabase.from("employee_grades").select("*").order("id");

	if (error) {
		throw error;
	}

	return data as EmployeeGrade[];
}
