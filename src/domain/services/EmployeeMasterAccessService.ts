import type { EmployeeRoleName } from "../entities/EmployeeProfile";

export type EmployeeMasterMode = "admin" | "reviewer" | "employee";

export function resolveEmployeeMasterMode(roleName: EmployeeRoleName): EmployeeMasterMode {
	if (roleName === "Admin") {
		return "admin";
	}
	if (roleName === "Reviewer") {
		return "reviewer";
	}
	return "employee";
}

export function canAssignEvaluator(roleName: EmployeeRoleName): boolean {
	return resolveEmployeeMasterMode(roleName) === "reviewer";
}

export function canViewAllApprovalRelations(roleName: EmployeeRoleName): boolean {
	return resolveEmployeeMasterMode(roleName) === "admin";
}
