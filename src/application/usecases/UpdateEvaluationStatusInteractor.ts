import type { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
import {
	describeSheetTransitionError,
	type SheetTransitionError,
} from "../../domain/entities/SheetTransitionError";
import { err, ok, type Result } from "../../domain/Result";
import type {
	EmailNotificationRepository,
	NotificationDelivery,
	ReportDelivery,
} from "../../domain/repositories/EmailNotificationRepository";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import {
	describeSheetAccessError,
	type SheetAccessError,
} from "../../domain/services/SheetAccessError";
import type {
	EvaluationStatus,
	EvaluationStatusValue,
	SheetActor,
} from "../../domain/valueObjects/EvaluationStatus";
import { GoalReturnReason } from "../../domain/valueObjects/GoalReturnReason";
import type { EvaluationSheetDto } from "../dtos/EvaluationSheetDto";
import { toEvaluationSheetDto } from "../dtos/EvaluationSheetMapper";
import type { OutputPort } from "../ports/OutputPort";
import type { FallibleUseCase } from "../ports/UseCase";

export interface UpdateEvaluationStatusRequest {
	sheetId: number;
	/**
	 * 進める先の状態。下書き: 一次評価者が要修正として戻す / 送信済み: 本人が目標を送信 /
	 * 目標確定: 一次評価者が承認 / 一次評価待ち: 本人が一次評価を依頼 /
	 * 一次評価済み: 一次評価者が一次評価を確定する / 評価確定: 最終評価者が評価を確定する。
	 */
	status: EvaluationStatus;
	currentEmployeeId: number;
	/** false なら、確定しても通知メールを送らない。省略すると送る。 */
	notify?: boolean;
	/** 下書きへ戻すときの理由(必須、200 文字以内)。本人のシートと通知メールに出る。ほかの状態では使わない。 */
	returnReason?: string;
}

export interface UpdateEvaluationStatusResponse {
	sheet: EvaluationSheetDto | null;
}

export interface UpdateEvaluationStatusOutputPort
	extends OutputPort<UpdateEvaluationStatusResponse> {
	/** 通知メールの宛先ごとの送信結果。確定を present した後、送信が終わるたびに届く。 */
	presentNotificationDelivery?(delivery: NotificationDelivery): void;
}

export type UpdateEvaluationStatusError =
	| SheetAccessError
	| SheetTransitionError
	| { kind: "sheetNotFound" };

export type ResendNotificationError = Extract<SheetAccessError, { kind: "forbidden" }>;

export function describeUpdateEvaluationStatusError(error: UpdateEvaluationStatusError): string {
	switch (error.kind) {
		case "sheetNotFound":
			return "評価シートが見つかりません。";
		case "periodClosed":
		case "forbidden":
		case "transitionForbidden":
			return describeSheetAccessError(error);
		case "objectivesIncomplete":
		case "evaluationIncomplete":
		case "returnReasonInvalid":
			return describeSheetTransitionError(error);
	}
}

export function describeResendNotificationError(error: ResendNotificationError): string {
	return describeSheetAccessError(error);
}

const RECIPIENT_LABELS: Record<SheetActor, string> = {
	subject: "本人",
	primary: "一次評価者",
	secondary: "二次評価者",
};

export class UpdateEvaluationStatusInteractor
	implements
		FallibleUseCase<
			UpdateEvaluationStatusRequest,
			UpdateEvaluationStatusOutputPort,
			UpdateEvaluationStatusError
		>
{
	constructor(
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
		private readonly employeeRepository: EmployeeRepository,
		private readonly emailNotificationRepository?: EmailNotificationRepository,
	) {}

	async execute(
		request: UpdateEvaluationStatusRequest,
		outputPort: UpdateEvaluationStatusOutputPort,
	): Promise<Result<void, UpdateEvaluationStatusError>> {
		const sheet = await this.evaluationSheetRepository.findById(request.sheetId);
		if (!sheet) {
			return err({ kind: "sheetNotFound" });
		}

		const policy = EvaluationSheetAccessPolicy.for(request.currentEmployeeId, sheet);
		const open = policy.periodOpen();
		if (!open.ok) {
			return open;
		}

		const resolved = this.resolveNewStatus(request, policy);
		if (!resolved.ok) {
			return resolved;
		}
		const newStatus = resolved.value;
		const readiness = sheet.readinessFor(newStatus);
		if (!readiness.ok) {
			return readiness;
		}
		let updated: EvaluationSheet | null;
		if (newStatus.isDraft()) {
			const reason = GoalReturnReason.from(request.returnReason ?? "");
			if (!reason.ok) {
				return reason;
			}
			await this.evaluationSheetRepository.returnGoals(request.sheetId, reason.value);
			// 下書きに戻すと、戻した評価者はもう読めない。その人には本文を返さない
			updated = null;
		} else {
			// 評価ランクは確定した時点の点数で決まる。以後は保存値を使い、配点の見直しなどに左右されないようにする。
			updated = await this.evaluationSheetRepository.updateStatus(request.sheetId, newStatus, {
				...(newStatus.isAwaitingSecondEvaluation() ||
				(newStatus.isFinalized() && sheet.primaryIsFinalEvaluator())
					? { first: sheet.resolveFirstEvaluationRank() }
					: {}),
				...(newStatus.isFinalized() ? { final: sheet.resolveFinalEvaluationRank() } : {}),
			});
		}
		const saved = updated ?? sheet.withStatus(newStatus);
		const viewer = EvaluationSheetAccessPolicy.for(request.currentEmployeeId, saved);
		if (updated && viewer.canViewSheet()) {
			const gradeName = await this.employeeRepository.findGradeName(updated.gradeId);
			outputPort.present({ sheet: toEvaluationSheetDto(updated, gradeName, viewer) });
		} else {
			outputPort.present({ sheet: null });
		}
		if (request.notify !== false) {
			void this.notify(saved, (delivery) => outputPort.presentNotificationDelivery?.(delivery));
		}
		return ok(undefined);
	}

	async resendNotification(
		sheetId: number,
		currentEmployeeId: number,
		report: ReportDelivery,
	): Promise<Result<void, ResendNotificationError>> {
		const sheet = await this.evaluationSheetRepository.findById(sheetId);
		if (
			!sheet ||
			!EvaluationSheetAccessPolicy.for(currentEmployeeId, sheet).canResendNotification()
		) {
			return err({ kind: "forbidden", action: "resendNotification" });
		}
		await this.notify(sheet, report);
		return ok(undefined);
	}

	/**
	 * いまの状態へシートを受け取った人(EvaluationStatus.handoff の to)へメールで知らせる。
	 * 宛先のアドレスと文面はサーバーが状態から決める。評価の確定は、次に動く人がいないので知らせない。
	 * 送信の失敗で状態の変更は取り消さない。
	 */
	private async notify(sheet: EvaluationSheet, report: ReportDelivery): Promise<void> {
		const repository = this.emailNotificationRepository;
		const handoff = sheet.status.handoff();
		// アプリ内通知は、状態の変更と同時に DB が作っている
		if (!repository || !sheet.notifiesByMail || !handoff) {
			return;
		}

		const notification = {
			sheetId: sheet.sheetId,
			employeeName: sheet.subject.name,
			employeeNo: sheet.subject.employeeNo,
			periodName: sheet.evaluationPeriod.periodName,
			primaryEvaluatorName: sheet.primaryEvaluatorName,
			secondaryEvaluatorName: sheet.secondaryEvaluatorName,
		};
		try {
			await repository.notifySheetStatusChanged(notification, report);
		} catch (error) {
			// 宛先や SMTP 設定を読めず、誰にも送れなかった
			console.error("評価の通知メールの送信に失敗しました:", error);
			const message = (error as { message?: unknown } | null)?.message;
			report({
				recipient: RECIPIENT_LABELS[handoff.to],
				error: typeof message === "string" ? message : "通知メールを送信できませんでした。",
			});
		}
	}

	/** 進める先の状態ごとに、その操作をしてよい人かを確かめる。 */
	private resolveNewStatus(
		request: UpdateEvaluationStatusRequest,
		policy: EvaluationSheetAccessPolicy,
	): Result<EvaluationStatus, UpdateEvaluationStatusError> {
		const allowed: Record<EvaluationStatusValue, boolean> = {
			draft: policy.canReturnGoalsToDraft(),
			submitted: policy.canRequestFirstEvaluation(),
			goals_submitted: policy.canSubmitGoals(),
			goals_confirmed: policy.canConfirmGoals(),
			first_evaluated: policy.canConfirmFirstEvaluation(),
			finalized: policy.canFinalizeEvaluation(),
		};
		if (!allowed[request.status.toString()]) {
			return err({ kind: "transitionForbidden", to: request.status.toString() });
		}
		return ok(request.status);
	}
}
