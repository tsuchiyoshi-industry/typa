import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
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
		});
	}
}
