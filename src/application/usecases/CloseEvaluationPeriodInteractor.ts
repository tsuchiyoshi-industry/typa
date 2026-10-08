import type { EvaluationPeriod } from "../../domain/entities/EvaluationPeriod";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { EvaluationPeriodRepository } from "../../domain/repositories/EvaluationPeriodRepository";
import { canEditSettings } from "../../domain/services/EmployeeMasterAccessService";
import type { EvaluationPeriodDto } from "../dtos/EvaluationPeriodDto";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface CloseEvaluationPeriodRequest {
	/** 次に実施中にする期間。いま実施中の期間は、同時に締められる。 */
	nextPeriodId: number;
	/** false なら、締められるかを確かめるだけで何も変えない(確認ダイアログを出す前に使う)。 */
	confirmed: boolean;
}

export type CloseEvaluationPeriodResponse =
	| { status: "rejected"; message: string }
	/** 締められる。まだ何も変えていない。closing が null なら、実施中の期間がなく、締める期間はない。 */
	| {
			status: "ready";
			closing: EvaluationPeriodDto | null;
			next: EvaluationPeriodDto;
			/** 締める期間の、評価確定のシートの枚数。 */
			finalizedSheets: number;
	  }
	| { status: "closed"; message: string };

const toDto = (period: EvaluationPeriod): EvaluationPeriodDto => ({
	id: period.id,
	periodName: period.periodName,
	startDate: period.startDate,
	endDate: period.endDate,
	isActive: period.isActive,
});

/**
 * 期間締め。次の期間を実施中にし、いま実施中の期間を同時に締める(実施中の期間は常に1つ)。
 * 締める期間に未確定の評価シートが1枚でも残っていると締められない。締めた期間のシートは
 * 誰も変更できなくなる。Admin だけが行える(DB側でも同じ条件で拒否する)。
 * 元の期間をもう一度この手順で実施中にすれば、同じ条件のもとで元に戻せる。
 */
export class CloseEvaluationPeriodInteractor
	implements UseCase<CloseEvaluationPeriodRequest, OutputPort<CloseEvaluationPeriodResponse>>
{
	constructor(
		private readonly periodRepository: EvaluationPeriodRepository,
		private readonly employeeMasterRepository: EmployeeMasterRepository,
	) {}

	async execute(
		request: CloseEvaluationPeriodRequest,
		outputPort: OutputPort<CloseEvaluationPeriodResponse>,
	): Promise<void> {
		const reject = (message: string) => outputPort.present({ status: "rejected", message });

		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee || !canEditSettings(currentEmployee.role)) {
			return reject("評価期間を締められるのは Admin のみです。");
		}

		const periods = await this.periodRepository.findDistinctPeriods();
		const next = periods.find((period) => period.id === request.nextPeriodId);
		if (!next) {
			return reject("評価期間が見つかりませんでした。");
		}
		if (next.isActive) {
			return reject(`「${next.periodName}」は既に実施中です。`);
		}

		const closing = periods.find((period) => period.isActive) ?? null;
		const counts = closing ? await this.periodRepository.countSheetsByStatus(closing.id) : {};
		const unfinished = [
			["下書き", counts.draft ?? 0],
			["提出済み", counts.submitted ?? 0],
			["一次評価済み", counts.first_evaluated ?? 0],
		] as const;
		const unfinishedTotal = unfinished.reduce((sum, [, count]) => sum + count, 0);
		if (closing && unfinishedTotal > 0) {
			const breakdown = unfinished
				.filter(([, count]) => count > 0)
				.map(([label, count]) => `${label} ${count} 件`)
				.join("・");
			return reject(
				`「${closing.periodName}」に未確定の評価シートが ${unfinishedTotal} 件あります（${breakdown}）。すべての評価を確定してから締めてください。`,
			);
		}

		if (!request.confirmed) {
			return outputPort.present({
				status: "ready",
				closing: closing && toDto(closing),
				next: toDto(next),
				finalizedSheets: counts.finalized ?? 0,
			});
		}

		if (!(await this.periodRepository.activate(next.id))) {
			return reject("評価期間を切り替えられませんでした。");
		}
		outputPort.present({
			status: "closed",
			message: closing
				? `「${closing.periodName}」を締め、「${next.periodName}」を開始しました。`
				: `「${next.periodName}」を開始しました。`,
		});
	}
}
