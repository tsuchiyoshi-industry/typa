import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import type { EvaluationSheetDto } from "../dtos/EvaluationSheetDto";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export type OverallCommentTarget = "first" | "second";

export interface UpdateOverallCommentRequest {
	sheetId: number;
	target: OverallCommentTarget;
	comment: string;
	canEditFirst: boolean;
	canEditSecond: boolean;
}

export interface UpdateOverallCommentResponse {
	sheet: EvaluationSheetDto;
}

export interface UpdateOverallCommentOutputPort extends OutputPort<UpdateOverallCommentResponse> {}

export class UpdateOverallCommentInteractor
	implements UseCase<UpdateOverallCommentRequest, UpdateOverallCommentOutputPort>
{
	constructor(
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
		private readonly employeeRepository: EmployeeRepository,
	) {}

	async execute(
		request: UpdateOverallCommentRequest,
		outputPort: UpdateOverallCommentOutputPort,
	): Promise<void> {
		if (request.target === "first" && !request.canEditFirst) {
			throw new Error("一次評価者の総評を更新する権限がありません。");
		}
		if (request.target === "second" && !request.canEditSecond) {
			throw new Error("二次評価者の総評を更新する権限がありません。");
		}

		const updated = await this.evaluationSheetRepository.updateOverallComment(
			request.sheetId,
			request.target,
			request.comment,
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
					isEditable: objective.isEditable,
				})),
			},
		});
	}
}
