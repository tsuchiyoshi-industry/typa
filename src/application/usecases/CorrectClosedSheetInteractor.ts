import { DomainError } from "../../domain/DomainError";
import {
	type RequestedChange,
	RetroactiveCorrection,
} from "../../domain/entities/RetroactiveCorrection";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { SheetCorrectionRepository } from "../../domain/repositories/SheetCorrectionRepository";
import { canCorrectClosedSheets } from "../../domain/services/EmployeeMasterAccessService";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface CorrectClosedSheetRequest {
	sheetId: number;
	changes: RequestedChange[];
	reason: string;
	/** false なら、直せるかを確かめて内容を返すだけで、何も直さない(確認ダイアログを出す前に使う)。 */
	confirmed: boolean;
}

export type CorrectClosedSheetResponse =
	| { status: "rejected"; message: string }
	/** 直せる。まだ何も直していない。 */
	| { status: "ready"; changes: { subject: string; before: string; after: string }[] }
	| { status: "corrected"; message: string };

/**
 * 遡及処理(締め後修正)。締めた評価期間を開き直さず、締めたシートの項目を直して、直したことを残す。
 * Admin だけが行える(DB 関数も同じ条件で拒否する)。直したことは、そのシートを振り返る本人・評価者に見える。
 */
export class CorrectClosedSheetInteractor
	implements UseCase<CorrectClosedSheetRequest, OutputPort<CorrectClosedSheetResponse>>
{
	constructor(
		private readonly correctionRepository: SheetCorrectionRepository,
		private readonly employeeMasterRepository: EmployeeMasterRepository,
	) {}

	async execute(
		request: CorrectClosedSheetRequest,
		outputPort: OutputPort<CorrectClosedSheetResponse>,
	): Promise<void> {
		const reject = (message: string) => outputPort.present({ status: "rejected", message });

		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee || !canCorrectClosedSheets(currentEmployee.role)) {
			return reject("遡及処理を行えるのは Admin のみです。");
		}

		const sheet = await this.correctionRepository.findClosedSheet(request.sheetId);
		let correction: RetroactiveCorrection;
		try {
			correction = RetroactiveCorrection.propose(sheet, request.changes, request.reason);
		} catch (error) {
			if (error instanceof DomainError) {
				return reject(error.message);
			}
			throw error;
		}

		if (!request.confirmed) {
			return outputPort.present({
				status: "ready",
				changes: correction.changes.map((change) => ({
					subject: change.subject,
					before: change.beforeText,
					after: change.afterText,
				})),
			});
		}

		const count = await this.correctionRepository.record(correction);
		outputPort.present({
			status: "corrected",
			message: `${sheet.subject.name}さんの「${sheet.evaluationPeriod.periodName}」のシートを ${count} 件修正しました。修正したことは、本人と評価者のシートに表示されます。`,
		});
	}
}
