import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { EvaluationPeriodRepository } from "../../domain/repositories/EvaluationPeriodRepository";
import { canEditSettings } from "../../domain/services/EmployeeMasterAccessService";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface SaveEvaluationPeriodRequest {
	/** 省略すると追加。指定すると、その期間の名前と日付を変える。 */
	periodId?: number;
	periodName: string;
	startDate: string;
	endDate: string;
}

export interface EvaluationPeriodChangeResponse {
	success: boolean;
	message: string;
}

/** YYYY-MM-DD で、実在する日付か。 */
const isDate = (value: string) => {
	const date = new Date(`${value}T00:00:00Z`);
	return (
		/^\d{4}-\d{2}-\d{2}$/.test(value) &&
		!Number.isNaN(date.getTime()) &&
		date.toISOString().startsWith(value)
	);
};

/**
 * 評価期間を追加する、または名前と日付を変える。Admin だけが行える(DB側でも Admin 以外は拒否する)。
 * 実施中かどうかはここでは変わらない。追加した期間は締めた状態で始まり、期間締めで実施中になる。
 */
export class SaveEvaluationPeriodInteractor
	implements UseCase<SaveEvaluationPeriodRequest, OutputPort<EvaluationPeriodChangeResponse>>
{
	constructor(
		private readonly periodRepository: EvaluationPeriodRepository,
		private readonly employeeMasterRepository: EmployeeMasterRepository,
	) {}

	async execute(
		request: SaveEvaluationPeriodRequest,
		outputPort: OutputPort<EvaluationPeriodChangeResponse>,
	): Promise<void> {
		const reject = (message: string) => outputPort.present({ success: false, message });

		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee || !canEditSettings(currentEmployee.role)) {
			return reject("評価期間を変更できるのは Admin のみです。");
		}

		const input = {
			periodName: request.periodName.trim(),
			startDate: request.startDate,
			endDate: request.endDate,
		};
		if (!input.periodName) {
			return reject("期間名を入力してください。");
		}
		if (!isDate(input.startDate) || !isDate(input.endDate)) {
			return reject("開始日と終了日を入力してください。");
		}
		if (input.startDate > input.endDate) {
			return reject("終了日は開始日以降の日付にしてください。");
		}

		const periods = await this.periodRepository.findDistinctPeriods();
		if (request.periodId !== undefined && !periods.some(({ id }) => id === request.periodId)) {
			return reject("評価期間が見つかりませんでした。");
		}
		if (periods.some((p) => p.periodName === input.periodName && p.id !== request.periodId)) {
			return reject(`「${input.periodName}」という評価期間は既にあります。`);
		}

		const saved =
			request.periodId === undefined
				? await this.periodRepository.create(input)
				: await this.periodRepository.update(request.periodId, input);
		if (!saved) {
			return reject("評価期間を保存できませんでした。");
		}
		outputPort.present({
			success: true,
			message:
				request.periodId === undefined
					? `評価期間「${input.periodName}」を追加しました。開始するには、一覧の「この期間を開始する」を押してください。`
					: `評価期間「${input.periodName}」を保存しました。`,
		});
	}
}
