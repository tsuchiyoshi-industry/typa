import type { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
import type { EmailNotificationRepository } from "../../domain/repositories/EmailNotificationRepository";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import type {
	EvaluationStatus,
	EvaluationStatusValue,
} from "../../domain/valueObjects/EvaluationStatus";
import type { EvaluationSheetDto } from "../dtos/EvaluationSheetDto";
import { toEvaluationSheetDto } from "../dtos/EvaluationSheetMapper";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface UpdateEvaluationStatusRequest {
	sheetId: number;
	/**
	 * 進める先の状態。下書き: 本人が下書きに戻す / 提出済み: 本人が提出する /
	 * 一次評価済み: 一次評価者が一次評価を確定する / 評価確定: 最終評価者が評価を確定する。
	 */
	status: EvaluationStatus;
	currentEmployeeId: number;
}

export interface UpdateEvaluationStatusResponse {
	sheet: EvaluationSheetDto;
	notificationWarning?: string;
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
		if (newStatus.isFirstEvaluationConfirmed()) {
			const stage =
				newStatus.isFinalized() && !sheet.primaryIsFinalEvaluator() ? "second" : "first";
			const pending = sheet.pendingEvaluationItems(stage);
			if (pending.length > 0) {
				throw new Error(
					`${stage === "first" ? "一次" : "二次"}評価に未設定の項目が ${pending.length} 件あります。すべての評価を 1〜4 で設定して保存してください。\n${pending.map((item) => `・${item}`).join("\n")}`,
				);
			}
		}
		if (newStatus.isFinalized()) {
			// 確定後は評価者の付け替えに左右されないよう、最終評価の集計をここで保存する。
			// 二次評価者「なし」の社員は、一次評価の合計がそのまま最終評価の合計になる。
			await this.evaluationSheetRepository.updateScoreTotals(request.sheetId, {
				...(sheet.primaryIsFinalEvaluator()
					? {
							objectives: sheet.objectiveScoreTotals.withFirstAsFinal(),
							commonEvaluationResults: sheet.commonEvaluationScoreTotals.withFirstAsFinal(),
						}
					: {}),
				allocatedScores: sheet.allocatedScores,
			});
		}
		// 評価ランクは確定した時点の点数で決まる。以後は保存値を使い、配点の見直しなどに左右されないようにする。
		const updated = await this.evaluationSheetRepository.updateStatus(request.sheetId, newStatus, {
			...(newStatus.isAwaitingSecondEvaluation() ||
			(newStatus.isFinalized() && sheet.primaryIsFinalEvaluator())
				? { first: sheet.resolveFirstEvaluationRank() }
				: {}),
			...(newStatus.isFinalized() ? { final: sheet.resolveFinalEvaluationRank() } : {}),
		});
		const gradeName = await this.employeeRepository.findGradeName(updated.subject.gradeId);

		const notificationWarning = await this.notify(updated);

		outputPort.present({
			sheet: toEvaluationSheetDto(updated, gradeName, policy),
			...(notificationWarning ? { notificationWarning } : {}),
		});
	}

	/** 一次評価の確定は二次評価者へ、評価の確定は評価者へメールで知らせる。送信の失敗で確定は取り消さない。 */
	private async notify(sheet: EvaluationSheet): Promise<string | undefined> {
		const firstConfirmed = sheet.status.isAwaitingSecondEvaluation();
		if (!this.emailNotificationRepository || !(firstConfirmed || sheet.status.isFinalized())) {
			return;
		}

		const notification = {
			sheetId: sheet.sheetId,
			employeeName: sheet.subject.name,
			employeeNo: sheet.subject.employeeNo,
			periodName: sheet.evaluationPeriod.periodName,
		};
		try {
			await (firstConfirmed
				? this.emailNotificationRepository.notifyFirstEvaluationConfirmed(notification)
				: this.emailNotificationRepository.notifySheetFinalized(notification));
		} catch (error) {
			console.error("評価の通知メールの送信に失敗しました:", error);
			return firstConfirmed
				? "一次評価は確定しましたが、二次評価者へ通知メールを送信できませんでした。二次評価者に直接お知らせください。"
				: "評価は確定しましたが、通知メールを送信できなかった評価者がいます。登録メールとSMTP設定を確認してください。";
		}
	}

	/** 進める先の状態ごとに、その操作をしてよい人かを確かめる。 */
	private resolveNewStatus(
		request: UpdateEvaluationStatusRequest,
		policy: EvaluationSheetAccessPolicy,
	): EvaluationStatus {
		const rules: Record<EvaluationStatusValue, { allowed: boolean; denied: string }> = {
			draft: {
				allowed: policy.canRevertOwnSheetToDraft(),
				denied: "この評価シートを下書きに戻す権限がありません。一次評価の確定後は戻せません。",
			},
			submitted: {
				allowed: policy.canSubmitOwnSheet(),
				denied: "自分の評価シートのみ提出できます。",
			},
			first_evaluated: {
				allowed: policy.canConfirmFirstEvaluation(),
				denied: "一次評価者のみ、提出済みのシートの一次評価を確定できます。",
			},
			finalized: {
				allowed: policy.canFinalizeEvaluation(),
				denied:
					"最終評価者(二次評価者。「なし」の場合は一次評価者)のみ、一次評価が確定したシートを確定できます。二次評価者が未設定の場合は、先に社員マスタで設定してください。",
			},
		};
		const rule = rules[request.status.toString()];
		if (!rule.allowed) {
			throw new Error(rule.denied);
		}
		return request.status;
	}
}
