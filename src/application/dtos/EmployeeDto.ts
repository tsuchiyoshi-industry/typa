export interface EmployeeDto {
	id: number;
	name: string;
	employeeNo: string;
	roleId: number;
	careerCourse: string | null;
	gradeId: number | null;
	primaryEvaluatorId: number | null;
	secondaryEvaluatorId: number | null;
	gradeName: string;
}
