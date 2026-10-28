import {
	PrivilegedSheetOperation,
	type PrivilegedSheetOperationError,
	type PrivilegedSheetOperationRequest,
} from "../../domain/entities/PrivilegedSheetOperation";
import { err, ok, type Result } from "../../domain/Result";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { PrivilegedSheetRepository } from "../../domain/repositories/PrivilegedSheetRepository";
import { canRunPrivilegedOperations } from "../../domain/services/EmployeeMasterAccessService";
import type { OutputPort } from "../ports/OutputPort";
import type { FallibleUseCase } from "../ports/UseCase";

export function describePrivilegedSheetOperationError(
	error: PrivilegedSheetOperationError,
): string {
	const messages: Record<PrivilegedSheetOperationError["kind"], string> = {
		forbidden: "遡及処理は Admin のみ利用できます。",
		invalidSheetId: "評価シートを選んでください。",
		invalidOperation: "操作を選んでください。",
		invalidStatus: "シートの状態が正しくありません。",
		sameStatus: "現在とは異なる状態を選んでください。",
		reasonInvalid: "操作の理由を 500 文字以内で入力してください。",
	};
	return messages[error.kind];
}

export class PrivilegedSheetOperationInteractor
	implements
		FallibleUseCase<
			PrivilegedSheetOperationRequest,
			OutputPort<{ message: string }>,
			PrivilegedSheetOperationError
		>
{
	constructor(
		private readonly repository: PrivilegedSheetRepository,
		private readonly employees: Pick<EmployeeMasterRepository, "findCurrentEmployeeProfile">,
	) {}

	async execute(
		request: PrivilegedSheetOperationRequest,
		output: OutputPort<{ message: string }>,
	): Promise<Result<void, PrivilegedSheetOperationError>> {
		const actor = await this.employees.findCurrentEmployeeProfile();
		if (!actor?.enabled || !canRunPrivilegedOperations(actor.role)) {
			return err({ kind: "forbidden" });
		}
		const operation = PrivilegedSheetOperation.from(request);
		if (!operation.ok) {
			return operation;
		}
		await this.repository.execute(operation.value);
		output.present({
			message:
				request.action === "delete"
					? "シートを削除し、監査ログに記録しました。"
					: "シートの状態を変更し、監査ログに記録しました。",
		});
		return ok(undefined);
	}
}
