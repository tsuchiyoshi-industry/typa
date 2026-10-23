/** 業務のきまりに反する入力。message は、そのまま利用者に見せられる文にする。 */
export class DomainError extends Error {
	override name = "DomainError";
}
