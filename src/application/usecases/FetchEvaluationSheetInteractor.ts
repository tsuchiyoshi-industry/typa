import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import {
	COMMON_EVALUATION_ALLOCATION_SCORE,
	OBJECTIVE_EVALUATION_ALLOCATION_SCORE,
} from "../../domain/valueObjects/EvaluationAllocatedScores";
import type { EvaluationSheetDto } from "../dtos/EvaluationSheetDto";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface FetchEvaluationSheetRequest {
	sheetId: number;
}

export interface FetchEvaluationSheetResponse extends EvaluationSheetDto {}

export interface FetchEvaluationSheetOutputPort extends OutputPort<FetchEvaluationSheetResponse> {}

export class FetchEvaluationSheetInteractor
	implements UseCase<FetchEvaluationSheetRequest, FetchEvaluationSheetOutputPort>
{
	constructor(
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
		private readonly employeeRepository: EmployeeRepository,
	) {}

	async execute(
		request: FetchEvaluationSheetRequest,
		outputPort: FetchEvaluationSheetOutputPort,
	): Promise<void> {
		const sheet = await this.evaluationSheetRepository.findById(request.sheetId);
		if (!sheet) {
			outputPort.present({
				sheetId: 0,
				subject: null,
				evaluationPeriod: null,
				primaryEvaluator: "未設定",
				secondaryEvaluator: "未設定",
				firstOverallComment: "",
				secondOverallComment: "",
				objectives: [],
				objectiveScoreTotals: {
					firstTotalScore: 0,
					firstTotalRate: 0,
					secondTotalScore: 0,
					secondTotalRate: 0,
				},
				commonEvaluationScoreTotals: {
					firstTotalScore: 0,
					firstTotalRate: 0,
					secondTotalScore: 0,
					secondTotalRate: 0,
				},
				allocatedScores: {
					objectiveAllocationScore: OBJECTIVE_EVALUATION_ALLOCATION_SCORE,
					objectiveSecondRate: 0,
					objectiveEvaluationScore: 0,
					commonEvaluationAllocationScore: COMMON_EVALUATION_ALLOCATION_SCORE,
					commonEvaluationSecondRate: 0,
					commonEvaluationEvaluationScore: 0,
					totalEvaluationScore: 0,
				},
			});
			return;
		}

		const gradeName = await this.employeeRepository.findGradeName(sheet.subject.gradeId);
		outputPort.present({
			sheetId: sheet.sheetId,
			subject: {
				id: sheet.subject.id,
				name: sheet.subject.name,
				employeeNo: sheet.subject.employeeNo,
				roleId: sheet.subject.roleId,
				careerCourse: sheet.subject.careerCourse,
				gradeId: sheet.subject.gradeId,
				primaryEvaluatorId: sheet.subject.primaryEvaluatorId,
				secondaryEvaluatorId: sheet.subject.secondaryEvaluatorId,
				gradeName,
			},
			evaluationPeriod: {
				id: sheet.evaluationPeriod.id,
				periodName: sheet.evaluationPeriod.periodName,
				startDate: sheet.evaluationPeriod.startDate,
				endDate: sheet.evaluationPeriod.endDate,
				isActive: sheet.evaluationPeriod.isActive,
			},
			primaryEvaluator: sheet.primaryEvaluatorName,
			secondaryEvaluator: sheet.secondaryEvaluatorName,
			firstOverallComment: sheet.firstOverallComment,
			secondOverallComment: sheet.secondOverallComment,
			objectives: sheet.objectives.map((objective) => ({
				id: objective.id,
				sheetId: objective.sheetId,
				goalNumber: objective.goalNumber,
				challengeGoal: objective.challengeGoal,
				midtermGoal: objective.midtermGoal,
				achievement: objective.achievement,
				firstScore: objective.firstScore.toNumber(),
				secondScore: objective.secondScore.toNumber(),
				isEditable: objective.isEditable,
			})),
			objectiveScoreTotals: {
				firstTotalScore: sheet.objectiveScoreTotals.firstTotalScore,
				firstTotalRate: sheet.objectiveScoreTotals.firstTotalRate,
				secondTotalScore: sheet.objectiveScoreTotals.secondTotalScore,
				secondTotalRate: sheet.objectiveScoreTotals.secondTotalRate,
			},
			commonEvaluationScoreTotals: {
				firstTotalScore: sheet.commonEvaluationScoreTotals.firstTotalScore,
				firstTotalRate: sheet.commonEvaluationScoreTotals.firstTotalRate,
				secondTotalScore: sheet.commonEvaluationScoreTotals.secondTotalScore,
				secondTotalRate: sheet.commonEvaluationScoreTotals.secondTotalRate,
			},
			allocatedScores: {
				objectiveAllocationScore: sheet.allocatedScores.objectiveAllocationScore,
				objectiveSecondRate: sheet.allocatedScores.objectiveSecondRate,
				objectiveEvaluationScore: sheet.allocatedScores.objectiveEvaluationScore,
				commonEvaluationAllocationScore: sheet.allocatedScores.commonEvaluationAllocationScore,
				commonEvaluationSecondRate: sheet.allocatedScores.commonEvaluationSecondRate,
				commonEvaluationEvaluationScore: sheet.allocatedScores.commonEvaluationEvaluationScore,
				totalEvaluationScore: sheet.allocatedScores.totalEvaluationScore,
			},
			finalEvaluationRank: sheet.finalEvaluationRank
				? {
						letter: sheet.finalEvaluationRank.letter,
						level: sheet.finalEvaluationRank.level,
						displayText: sheet.finalEvaluationRank.toDisplayText(),
					}
				: undefined,
		});
	}
}
