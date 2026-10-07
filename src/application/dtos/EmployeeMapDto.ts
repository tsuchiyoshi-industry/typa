export interface EmployeeMapPersonDto {
	id: number;
	name: string;
	employeeNo: string;
	gradeName: string;
	careerCourse: string | null;
	/** 権限。Admin 以外には渡さない(null)。 */
	roleName: string | null;
	primaryEvaluatorId: number | null;
	secondaryEvaluatorId: number | null;
	noSecondaryEvaluator: boolean;
	registered: boolean;
}

export interface EmployeeMapDto {
	currentEmployeeId: number;
	people: EmployeeMapPersonDto[];
}
