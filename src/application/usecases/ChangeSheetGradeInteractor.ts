import {
	SheetGradeChange,
	type SheetGradeChangeError,
	type SheetGradeChangeRequest,
} from "../../domain/entities/SheetGradeChange";
import { err, ok, type Result } from "../../domain/Result";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { SheetGradeRepository } from "../../domain/repositories/SheetGradeRepository";
import { canRunPrivilegedOperations } from "../../domain/services/EmployeeMasterAccessService";
import type { OutputPort } from "../ports/OutputPort";
import type { FallibleUseCase } from "../ports/UseCase";

export function describeSheetGradeChangeError(error: SheetGradeChangeError): string {
	const messages: Record<SheetGradeChangeError["kind"], string> = {
		forbidden: "等級の変更は Admin のみ利用できます。",
		invalidSheetId: "評価シートを選んでください。",
		gradeRequired: "変更後の等級を選んでください。",
		sameGrade: "今と同じ等級には変更できません。",
		invalidStatus: "シートの状態が正しくありません。",
		firstEvaluationConfirmed:
			"一次評価が確定したシートの等級は変更できません。先に状態を一次評価待ちまでに戻してください。",
		reasonInvalid: "操作の理由を 500 文字以内で入力してください。",
	};
	return messages[error.kind];
}

/**
 * 当期のシートの作成時の等級を変える(Admin だけ)。共通評価の入力は消え、取り消せない。
 * 当期かどうか・確かめている間に変わっていないかは、DB 関数が同じトランザクションで確かめる。
 */
export class ChangeSheetGradeInteractor
	implements
		FallibleUseCase<SheetGradeChangeRequest, OutputPort<{ message: string }>, SheetGradeChangeError>
{
	constructor(
		private readonly repository: SheetGradeRepository,
		private readonly employees: Pick<EmployeeMasterRepository, "findCurrentEmployeeProfile">,
	) {}

	async execute(
		request: SheetGradeChangeRequest,
		output: OutputPort<{ message: string }>,
	): Promise<Result<void, SheetGradeChangeError>> {
		const actor = await this.employees.findCurrentEmployeeProfile();
		if (!actor?.enabled || !canRunPrivilegedOperations(actor.role)) {
			return err({ kind: "forbidden" });
		}
		const change = SheetGradeChange.from(request);
		if (!change.ok) {
			return change;
		}
		const deleted = await this.repository.execute(change.value);
		output.present({
			message:
				deleted > 0
					? `等級を変更し、共通評価の入力 ${deleted} 件を削除しました。監査ログに記録しました。`
					: "等級を変更しました。共通評価の入力はありませんでした。監査ログに記録しました。",
		});
		return ok(undefined);
	}
}
