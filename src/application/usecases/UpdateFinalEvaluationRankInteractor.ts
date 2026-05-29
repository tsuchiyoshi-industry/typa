import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import { FinalEvaluationRank } from "../../domain/valueObjects/FinalEvaluationRank";
import type { EvaluationSheetDto } from "../dtos/EvaluationSheetDto";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface UpdateFinalEvaluationRankRequest {
	sheetId: number;
	letter?: string;
	level?: string;
	canEditSecond: boolean;
}

export interface UpdateFinalEvaluationRankResponse {
	sheet: EvaluationSheetDto;
}

export interface UpdateFinalEvaluationRankOutputPort
	extends OutputPort<UpdateFinalEvaluationRankResponse> {}

export class UpdateFinalEvaluationRankInteractor
	implements UseCase<UpdateFinalEvaluationRankRequest, UpdateFinalEvaluationRankOutputPort>
{
	constructor(
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
		private readonly employeeRepository: EmployeeRepository,
	) {}

	async execute(
		request: UpdateFinalEvaluationRankRequest,
		outputPort: UpdateFinalEvaluationRankOutputPort,
	): Promise<void> {
		if (!request.canEditSecond) {
			throw new Error("二次評価者のみ最終評価ランクを決定できます。");
		}

		const finalEvaluationRank =
			request.letter && request.level
				? FinalEvaluationRank.fromOptional(request.letter, request.level)
				: undefined;
		const updated = await this.evaluationSheetRepository.updateFinalEvaluationRank(
			request.sheetId,
			finalEvaluationRank,
		);
		const gradeName = await this.employeeRepository.findGradeName(updated.subject.gradeId);

		outputPort.present({
			sheet: {
				sheetId: updated.sheetId,
				subject: {
					id: updated.subject.id,
					name: updated.subject.name,
					employeeNo: updated.subject.employeeNo,
					roleId: updated.subject.roleId,
					careerCourse: updated.subject.careerCourse,
					gradeId: updated.subject.gradeId,
					primaryEvaluatorId: updated.subject.primaryEvaluatorId,
					secondaryEvaluatorId: updated.subject.secondaryEvaluatorId,
					gradeName,
				},
				evaluationPeriod: {
					id: updated.evaluationPeriod.id,
					periodName: updated.evaluationPeriod.periodName,
					startDate: updated.evaluationPeriod.startDate,
					endDate: updated.evaluationPeriod.endDate,
					isActive: updated.evaluationPeriod.isActive,
				},
				primaryEvaluator: updated.primaryEvaluatorName,
				secondaryEvaluator: updated.secondaryEvaluatorName,
				firstOverallComment: updated.firstOverallComment,
				secondOverallComment: updated.secondOverallComment,
				objectives: updated.objectives.map((objective) => ({
					id: objective.id,
					sheetId: objective.sheetId,
					goalNumber: objective.goalNumber,
					challengeGoal: objective.challengeGoal,
					midtermGoal: objective.midtermGoal,
					achievement: objective.achievement,
					firstScore: objective.firstScore.toNumber(),
					secondScore: objective.secondScore.toNumber(),
				})),
				objectiveScoreTotals: {
					firstTotalScore: updated.objectiveScoreTotals.firstTotalScore,
					firstTotalRate: updated.objectiveScoreTotals.firstTotalRate,
					secondTotalScore: updated.objectiveScoreTotals.secondTotalScore,
					secondTotalRate: updated.objectiveScoreTotals.secondTotalRate,
				},
				commonEvaluationScoreTotals: {
					firstTotalScore: updated.commonEvaluationScoreTotals.firstTotalScore,
					firstTotalRate: updated.commonEvaluationScoreTotals.firstTotalRate,
					secondTotalScore: updated.commonEvaluationScoreTotals.secondTotalScore,
					secondTotalRate: updated.commonEvaluationScoreTotals.secondTotalRate,
				},
				allocatedScores: {
					objectiveAllocationScore: updated.allocatedScores.objectiveAllocationScore,
					objectiveSecondRate: updated.allocatedScores.objectiveSecondRate,
					objectiveEvaluationScore: updated.allocatedScores.objectiveEvaluationScore,
					commonEvaluationAllocationScore: updated.allocatedScores.commonEvaluationAllocationScore,
					commonEvaluationSecondRate: updated.allocatedScores.commonEvaluationSecondRate,
					commonEvaluationEvaluationScore: updated.allocatedScores.commonEvaluationEvaluationScore,
					totalEvaluationScore: updated.allocatedScores.totalEvaluationScore,
				},
				status: updated.status.toString(),
				isEditable: updated.isEditable(),
				finalEvaluationRank: updated.finalEvaluationRank
					? {
							letter: updated.finalEvaluationRank.letter,
							level: updated.finalEvaluationRank.level,
							displayText: updated.finalEvaluationRank.toDisplayText(),
						}
					: undefined,
			},
		});
	}
}
