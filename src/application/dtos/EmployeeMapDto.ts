export interface EmployeeMapPersonDto {
	id: number;
	name: string;
	employeeNo: string;
	gradeName: string;
	careerCourse: string | null;
	roleName: string;
	primaryEvaluatorId: number | null;
	secondaryEvaluatorId: number | null;
	noSecondaryEvaluator: boolean;
	registered: boolean;
}

export interface EmployeeMapDto {
	currentEmployeeId: number;
	people: EmployeeMapPersonDto[];
}
