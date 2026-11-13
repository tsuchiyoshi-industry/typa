import type { ReviewPeriodDto } from "../../application/dtos/ReviewerWorkspaceDto";
import { EvaluationCalendar } from "../../domain/entities/EvaluationCalendar";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { EvaluationPeriodRepository } from "../../domain/repositories/EvaluationPeriodRepository";
import type { ReviewerWorkspaceRepository } from "../../domain/repositories/ReviewerWorkspaceRepository";

/** 評価者になれない人が「部下の評価」を読もうとした。画面は一覧の代わりにこの旨だけを出す。 */
export class ReviewerOnlyError extends Error {
	constructor() {
		super("部下の評価は、評価者になれる社員だけが使えます。");
	}
}

export class ReviewerWorkspaceController {
	constructor(
		private readonly repository: ReviewerWorkspaceRepository,
		private readonly periods: EvaluationPeriodRepository,
		private readonly employees: Pick<EmployeeMasterRepository, "findCurrentEmployeeProfile">,
	) {}

	/** 評価者になれない人(役員以外の Employee)、利用停止中の人、分からない人には読ませない。 */
	private async assertCanReview(): Promise<void> {
		const actor = await this.employees.findCurrentEmployeeProfile();
		if (!actor?.enabled || !actor.canBeEvaluator()) {
			throw new ReviewerOnlyError();
		}
	}

	/**
	 * 部下の評価は、実施中の評価期間だけを見る(部下の今の進み具合を俯瞰する画面)。
	 * 締めてから次を開始するまでの間は null。過去の評価期間のシートは「評価シート」で期間を選んで開く。
	 */
	async currentPeriod(): Promise<ReviewPeriodDto | null> {
		await this.assertCanReview();
		return new EvaluationCalendar(await this.periods.findDistinctPeriods()).active();
	}

	async load(periodId: number) {
		await this.assertCanReview();
		return this.repository.load(periodId);
	}
}
