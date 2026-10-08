import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import type { MilestoneRepository } from "../../domain/repositories/MilestoneRepository";
import type { EvaluationScoreUpdateService } from "../../domain/services/EvaluationScoreUpdateService";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import type { MilestoneDto } from "../dtos/MilestoneDto";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface UpdateMilestoneRequest {
	sheetId: number;
	currentEmployeeId: number;
	milestoneId?: number;
	delete?: boolean;
	goalNumber?: number;
	challengeGoal?: string;
	midtermGoal?: string;
	achievement?: string;
	firstScore?: number;
	secondScore?: number;
}

export interface UpdateMilestoneResponse {
	milestone: MilestoneDto;
}

export interface UpdateMilestoneOutputPort extends OutputPort<UpdateMilestoneResponse> {}

export class UpdateMilestoneInteractor
	implements UseCase<UpdateMilestoneRequest, UpdateMilestoneOutputPort>
{
	constructor(
		private readonly milestoneRepository: MilestoneRepository,
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
		private readonly evaluationScoreUpdateService: EvaluationScoreUpdateService,
	) {}

	async execute(
		request: UpdateMilestoneRequest,
		outputPort: UpdateMilestoneOutputPort,
	): Promise<void> {
		const sheet = await this.evaluationSheetRepository.findById(request.sheetId);
		if (!sheet) {
			throw new Error("評価シートが見つかりません。");
		}
		const policy = EvaluationSheetAccessPolicy.for(request.currentEmployeeId, sheet);
		policy.assertPeriodOpen();
		const currentObjective = sheet.objectives.find((objective) =>
			request.milestoneId !== undefined
				? objective.id === request.milestoneId
				: objective.goalNumber === request.goalNumber,
		);
		// Validate the entire request before the first write, including the child resource binding.
		if (
			request.milestoneId !== undefined &&
			!sheet.objectives.some(
				(objective) => objective.id === request.milestoneId && objective.sheetId === sheet.sheetId,
			)
		) {
			throw new Error("対象の目標はこの評価シートに属していません。");
		}
		if (
			request.goalNumber !== undefined &&
			(!Number.isSafeInteger(request.goalNumber) ||
				request.goalNumber < 1 ||
				request.goalNumber > 4)
		) {
			throw new Error("目標番号が不正です。");
		}
		for (const score of [request.firstScore, request.secondScore]) {
			if (score !== undefined && (!Number.isInteger(score) || score < 0 || score > 4)) {
				throw new Error("目標の評価点は0から4の整数で指定してください。");
			}
		}
		if (request.firstScore !== undefined || request.secondScore !== undefined) {
			if (request.milestoneId === undefined) {
				throw new Error("Milestone ID is required to update milestone score.");
			}
			if (request.firstScore !== undefined && !policy.canEditMilestoneFirstScore()) {
				throw new Error("一次評価者のみ一次評価を編集できます。");
			}
			if (request.secondScore !== undefined && !policy.canEditMilestoneSecondScore()) {
				throw new Error("二次評価者のみ二次評価を編集できます。");
			}
		}

		let updated = null;
		if (request.delete) {
			if (!policy.canEditMilestoneGoal()) {
				throw new Error("自分の評価シートの目標のみ削除できます。");
			}
			if (!currentObjective) {
				throw new Error("対象の目標が見つかりません。");
			}
			if (sheet.objectives.length <= 1) {
				throw new Error("チャレンジ目標は最低1件必要です。");
			}
			if (
				[
					request.challengeGoal,
					request.midtermGoal,
					request.achievement,
					request.firstScore,
					request.secondScore,
				].some((value) => value !== undefined)
			) {
				throw new Error("削除と更新は同時に指定できません。");
			}
			await this.milestoneRepository.delete(currentObjective.id);
			updated = currentObjective;
		}
		if (!currentObjective && request.goalNumber !== undefined && sheet.objectives.length >= 4) {
			throw new Error("チャレンジ目標は最大4件です。");
		}

		if (
			request.challengeGoal !== undefined ||
			request.midtermGoal !== undefined ||
			request.achievement !== undefined
		) {
			if (!policy.canEditMilestoneGoal()) {
				throw new Error("自分の評価シートの目標のみ編集できます。");
			}

			if (request.milestoneId !== undefined) {
				updated = await this.milestoneRepository.updateText(
					request.milestoneId,
					request.challengeGoal ?? currentObjective?.challengeGoal ?? "",
					request.midtermGoal ?? currentObjective?.midtermGoal ?? "",
					request.achievement ?? currentObjective?.achievement ?? "",
				);
			} else if (request.goalNumber !== undefined) {
				updated = await this.milestoneRepository.upsertText(
					request.sheetId,
					request.goalNumber,
					request.challengeGoal ?? currentObjective?.challengeGoal ?? "",
					request.midtermGoal ?? currentObjective?.midtermGoal ?? "",
					request.achievement ?? currentObjective?.achievement ?? "",
				);
			}
		}

		if (request.firstScore !== undefined || request.secondScore !== undefined) {
			updated = await this.evaluationScoreUpdateService.updateObjectiveScore(
				request.milestoneId as number,
				request.firstScore,
				request.secondScore,
			);
		}

		if (!updated) {
			throw new Error("No milestone changes were provided.");
		}

		const canViewSecondScore = policy.canViewMilestoneSecondScore();
		outputPort.present({
			milestone: {
				id: updated.id,
				sheetId: updated.sheetId,
				goalNumber: updated.goalNumber,
				challengeGoal: updated.challengeGoal,
				midtermGoal: updated.midtermGoal,
				achievement: updated.achievement,
				firstScore: updated.firstScore.toNumber(),
				secondScore: canViewSecondScore ? updated.secondScore.toNumber() : null,
			},
		});
	}
}
