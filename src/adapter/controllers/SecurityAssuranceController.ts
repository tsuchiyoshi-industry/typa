import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import { canViewSecurityAssurance } from "../../domain/services/EmployeeMasterAccessService";
import {
	buildSecurityAssurance,
	type SecurityAssuranceView,
} from "../viewmodels/securityAssurance";

/** セキュリティの担保の画面(Admin だけ)。利用中の Admin でなければ、URL を直接開いても中身を渡さない。 */
export class SecurityAssuranceController {
	constructor(
		private readonly employees: Pick<EmployeeMasterRepository, "findCurrentEmployeeProfile">,
	) {}

	async open(): Promise<SecurityAssuranceView> {
		const actor = await this.employees.findCurrentEmployeeProfile();
		if (!actor?.enabled || !canViewSecurityAssurance(actor.role)) {
			throw new Error("セキュリティの担保は Admin のみ利用できます。");
		}
		return buildSecurityAssurance();
	}
}
