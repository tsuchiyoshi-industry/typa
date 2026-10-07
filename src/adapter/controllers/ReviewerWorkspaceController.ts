import type { ReviewPeriodDto } from "../../application/dtos/ReviewerWorkspaceDto";
import type { EvaluationPeriodRepository } from "../../domain/repositories/EvaluationPeriodRepository";
import type { ReviewerWorkspaceRepository } from "../../domain/repositories/ReviewerWorkspaceRepository";

export class ReviewerWorkspaceController {
	constructor(
		private readonly repository: ReviewerWorkspaceRepository,
		private readonly periods: EvaluationPeriodRepository,
	) {}

	async loadPeriods(): Promise<ReviewPeriodDto[]> {
		return (await this.periods.findDistinctPeriods()).sort((a, b) =>
			b.startDate.localeCompare(a.startDate),
		);
	}

	load(periodId: number) {
		return this.repository.load(periodId);
	}

	setReviewed(sheetId: number, revision: string, reviewed: boolean) {
		return this.repository.setReviewed(sheetId, revision, reviewed);
	}
}
