import type { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
import type {
	EmailNotificationRepository,
	NotificationDelivery,
	ReportDelivery,
} from "../../domain/repositories/EmailNotificationRepository";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import type {
	EvaluationStatus,
	EvaluationStatusValue,
	SheetActor,
} from "../../domain/valueObjects/EvaluationStatus";
import type { EvaluationSheetDto } from "../dtos/EvaluationSheetDto";
import { toEvaluationSheetDto } from "../dtos/EvaluationSheetMapper";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface UpdateEvaluationStatusRequest {
	sheetId: number;
	/**
	 * 進める先の状態。下書き: 一次評価者が要修正として戻す / 送信済み: 本人が目標を送信 /
	 * 目標確定: 一次評価者が承認 / 一次評価待ち: 本人が達成状況を提出 /
	 * 一次評価済み: 一次評価者が一次評価を確定する / 評価確定: 最終評価者が評価を確定する。
	 */
	status: EvaluationStatus;
	currentEmployeeId: number;
	/** false なら、確定しても通知メールを送らない。省略すると送る。 */
	notify?: boolean;
}

export interface UpdateEvaluationStatusResponse {
	sheet: EvaluationSheetDto | null;
}

export interface UpdateEvaluationStatusOutputPort
	extends OutputPort<UpdateEvaluationStatusResponse> {
	/** 通知メールの宛先ごとの送信結果。確定を present した後、送信が終わるたびに届く。 */
	presentNotificationDelivery?(delivery: NotificationDelivery): void;
}

const RECIPIENT_LABELS: Record<SheetActor, string> = {
	subject: "本人",
	primary: "一次評価者",
	secondary: "二次評価者",
};

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
		policy.assertPeriodOpen();

		const newStatus = this.resolveNewStatus(request, policy);
		if (newStatus.isSentToEvaluators() || newStatus.isFirstEvaluationConfirmed()) {
			const missing = sheet.pendingObjectiveFields();
			if (missing.length) {
				throw new Error(
					`チャレンジ目標が空欄の目標は提出・確定できません。入力して保存するか、不要なタブを削除してください。\n${missing.map((item) => `・${item}`).join("\n")}`,
				);
			}
		}
		if (newStatus.isFirstEvaluationConfirmed()) {
			const stage = sheet.confirmingStage(newStatus);
			const pending = sheet.pendingEvaluationItems(stage);
			if (pending.length > 0) {
				throw new Error(
					`${stage === "first" ? "一次" : "二次"}評価に未設定の項目が ${pending.length} 件あります。すべての評価を 1〜4 で設定して保存してください。\n${pending.map((item) => `・${item}`).join("\n")}`,
				);
			}
		}
		// 評価ランクは確定した時点の点数で決まる。以後は保存値を使い、配点の見直しなどに左右されないようにする。
		const updated = await this.evaluationSheetRepository.updateStatus(request.sheetId, newStatus, {
			...(newStatus.isAwaitingSecondEvaluation() ||
			(newStatus.isFinalized() && sheet.primaryIsFinalEvaluator())
				? { first: sheet.resolveFirstEvaluationRank() }
				: {}),
			...(newStatus.isFinalized() ? { final: sheet.resolveFinalEvaluationRank() } : {}),
		});
		// 要修正で下書きに戻すと、戻した評価者はもう読めない。その人には本文を返さない
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
	}

	async resendNotification(
		sheetId: number,
		currentEmployeeId: number,
		report: ReportDelivery,
	): Promise<void> {
		const sheet = await this.evaluationSheetRepository.findById(sheetId);
		if (
			!sheet ||
			!EvaluationSheetAccessPolicy.for(currentEmployeeId, sheet).canResendNotification()
		) {
			throw new Error("この評価シートの通知を送る権限がありません。");
		}
		await this.notify(sheet, report);
	}

	/**
	 * いまの状態へシートを受け取った人(EvaluationStatus.handoff の to)へメールで知らせる。
	 * 宛先のアドレスと文面はサーバーが状態から決める。評価の確定は、次に動く人がいないので知らせない。
	 * 送信の失敗で提出・確定は取り消さない。
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
	): EvaluationStatus {
		const rules: Record<EvaluationStatusValue, { allowed: boolean; denied: string }> = {
			draft: {
				allowed: policy.canReturnGoalsToDraft(),
				denied: "一次評価者のみ、送信済みの目標を要修正として下書きに戻せます。",
			},
			submitted: {
				allowed: policy.canRequestFirstEvaluation(),
				denied: "目標確定後に本人が達成状況を提出してください。",
			},
			goals_submitted: {
				allowed: policy.canSubmitGoals(),
				denied: "自分の下書きの目標のみ送信できます。",
			},
			goals_confirmed: {
				allowed: policy.canConfirmGoals(),
				denied: "一次評価者のみ、送信済みの目標を確定できます。",
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
