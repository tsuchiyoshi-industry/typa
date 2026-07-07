import type { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
import type { EmailNotificationRepository } from "../../domain/repositories/EmailNotificationRepository";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import type { EvaluationSheetDto } from "../dtos/EvaluationSheetDto";
import { toEvaluationSheetDto } from "../dtos/EvaluationSheetMapper";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface UpdateEvaluationStatusRequest {
	sheetId: number;
	status: "draft" | "submitted";
	/** 二次評価者による「評価の確定」操作かどうか。true の場合はシートを不可逆にロックする。 */
	asFinalization?: boolean;
	currentEmployeeId: number;
}

export interface UpdateEvaluationStatusResponse {
	sheet: EvaluationSheetDto;
}

export interface UpdateEvaluationStatusOutputPort
	extends OutputPort<UpdateEvaluationStatusResponse> {}

export class UpdateEvaluationStatusInteractor
	implements UseCase<UpdateEvaluationStatusRequest, UpdateEvaluationStatusOutputPort>
{
	constructor(
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
		private readonly employeeRepository: EmployeeRepository,
		private readonly emailNotificationRepository?: EmailNotificationRepository,
	) {}

	async execute(
		request: UpdateEvaluationStatusRequest,
		outputPort: UpdateEvaluationStatusOutputPort,
	): Promise<void> {
		const sheet = await this.evaluationSheetRepository.findById(request.sheetId);
		if (!sheet) {
			throw new Error("評価シートが見つかりません。");
		}

		const policy = EvaluationSheetAccessPolicy.for(request.currentEmployeeId, sheet);

		const newStatus = this.resolveNewStatus(request, policy);
		const updated = await this.evaluationSheetRepository.updateStatus(request.sheetId, newStatus);
		const gradeName = await this.employeeRepository.findGradeName(updated.subject.gradeId);

		if (newStatus.isFinalizedBySecondEvaluator()) {
			await this.notifySheetFinalized(updated);
		}

		outputPort.present({ sheet: toEvaluationSheetDto(updated, gradeName, policy) });
	}

	private async notifySheetFinalized(sheet: EvaluationSheet): Promise<void> {
		if (!this.emailNotificationRepository) {
			return;
		}

		try {
			await this.emailNotificationRepository.notifySheetFinalized({
				sheetId: sheet.sheetId,
				employeeName: sheet.subject.name,
				employeeNo: sheet.subject.employeeNo,
				periodName: sheet.evaluationPeriod.periodName,
				totalScore: sheet.allocatedScores.totalEvaluationScore,
			});
		} catch (error) {
			console.error("評価確定メールの送信に失敗しました:", error);
		}
	}

	private resolveNewStatus(
		request: UpdateEvaluationStatusRequest,
		policy: EvaluationSheetAccessPolicy,
	): EvaluationStatus {
		if (request.status === "draft") {
			if (!policy.canRevertOwnSheetToDraft()) {
				throw new Error("この評価シートを下書きに戻す権限がありません。");
			}
			return EvaluationStatus.DRAFT;
		}

		if (request.asFinalization) {
			if (!policy.canFinalizeAsSecondaryEvaluator()) {
				throw new Error("二次評価者のみ評価を確定できます。");
			}
			return EvaluationStatus.FINALIZED;
		}

		if (!policy.canSubmitOwnSheet()) {
			throw new Error("自分の評価シートのみ提出できます。");
		}
		return EvaluationStatus.SUBMITTED;
	}
}
