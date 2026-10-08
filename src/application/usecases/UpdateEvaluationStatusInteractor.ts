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
	/** false なら、確定しても通知メールを送らない。省略すると送る。 */
	notify?: boolean;
}

export interface UpdateEvaluationStatusResponse {
	sheet: EvaluationSheetDto;
}

export interface UpdateEvaluationStatusOutputPort
	extends OutputPort<UpdateEvaluationStatusResponse> {
	/** 通知メールの宛先ごとの送信結果。確定を present した後、送信が終わるたびに届く。 */
	presentNotificationDelivery?(delivery: NotificationDelivery): void;
}

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
		if (newStatus.isSubmitted() || newStatus.isFirstEvaluationConfirmed()) {
			const missing = sheet.pendingObjectiveFields();
			if (missing.length) {
				throw new Error(
					`チャレンジ目標が空欄の目標は提出・確定できません。入力して保存するか、不要なタブを削除してください。\n${missing.map((item) => `・${item}`).join("\n")}`,
				);
			}
		}
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
		const gradeName = await this.employeeRepository.findGradeName(updated.gradeId);

		outputPort.present({ sheet: toEvaluationSheetDto(updated, gradeName, policy) });

		// 送信の完了は待たない。確定は済んでおり、結果は宛先ごとに後から知らせる
		if (request.notify !== false) {
			void this.notify(updated, (delivery) => outputPort.presentNotificationDelivery?.(delivery));
		}
	}

	/**
	 * 提出は一次評価者へ、一次評価の確定は二次評価者へ、評価の確定は評価者へメールで知らせる。
	 * 送信の失敗で提出・確定は取り消さない。下書きに戻したときは知らせない。
	 */
	private async notify(sheet: EvaluationSheet, report: ReportDelivery): Promise<void> {
		const repository = this.emailNotificationRepository;
		const submitted = sheet.status.isAwaitingFirstEvaluation();
		const firstConfirmed = sheet.status.isAwaitingSecondEvaluation();
		if (!repository || !(submitted || firstConfirmed || sheet.status.isFinalized())) {
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
			await (submitted
				? repository.notifySheetSubmitted(notification, report)
				: firstConfirmed
					? repository.notifyFirstEvaluationConfirmed(notification, report)
					: repository.notifySheetFinalized(notification, report));
		} catch (error) {
			// 宛先や SMTP 設定を読めず、誰にも送れなかった
			console.error("評価の通知メールの送信に失敗しました:", error);
			const message = (error as { message?: unknown } | null)?.message;
			report({
				recipient: submitted ? "一次評価者" : firstConfirmed ? "二次評価者" : "評価者",
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
