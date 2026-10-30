import { err, ok, type Result } from "../Result";
import { EvaluationStatus, type EvaluationStatusValue } from "../valueObjects/EvaluationStatus";
import { charLength } from "../valueObjects/textLength";

export interface PrivilegedSheetOperationRequest {
	sheetId: number;
	expectedStatus: string;
	action: string;
	status?: string;
	reason: string;
}

export type PrivilegedSheetOperationError =
	| { kind: "forbidden" }
	| { kind: "invalidSheetId" }
	| { kind: "invalidOperation" }
	| { kind: "invalidStatus" }
	| { kind: "sameStatus" }
	| { kind: "reasonInvalid" };

/** 通常の進行条件を課さず、対象・操作・監査理由だけを確かめる特権操作。 */
export class PrivilegedSheetOperation {
	private constructor(
		readonly sheetId: number,
		readonly expectedStatus: EvaluationStatusValue,
		readonly action: "delete" | "changeStatus",
		readonly status: EvaluationStatusValue | null,
		readonly reason: string,
	) {}

	static from(
		request: PrivilegedSheetOperationRequest,
	): Result<PrivilegedSheetOperation, PrivilegedSheetOperationError> {
		if (!Number.isSafeInteger(request.sheetId) || request.sheetId < 1) {
			return err({ kind: "invalidSheetId" });
		}
		const expected = EvaluationStatus.find(request.expectedStatus);
		const next = EvaluationStatus.find(request.status);
		if (!expected || (request.action === "changeStatus" && !next)) {
			return err({ kind: "invalidStatus" });
		}
		if (
			(request.action !== "delete" && request.action !== "changeStatus") ||
			(request.action === "delete" && request.status !== undefined)
		) {
			return err({ kind: "invalidOperation" });
		}
		if (request.action === "changeStatus" && next === expected) {
			return err({ kind: "sameStatus" });
		}
		const reason = request.reason.trim();
		if (!reason || charLength(reason) > 500) {
			return err({ kind: "reasonInvalid" });
		}
		return ok(
			new PrivilegedSheetOperation(
				request.sheetId,
				expected.toString(),
				request.action,
				next?.toString() ?? null,
				reason,
			),
		);
	}
}
