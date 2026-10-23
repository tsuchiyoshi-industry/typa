import { DomainError } from "../../domain/DomainError";
import { EvaluationCalendar } from "../../domain/entities/EvaluationCalendar";
import type { EvaluationPeriodPlan } from "../../domain/entities/EvaluationPeriodPlan";
import { EvaluationTerm } from "../../domain/entities/EvaluationTerm";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { EvaluationPeriodRepository } from "../../domain/repositories/EvaluationPeriodRepository";
import { canEditSettings } from "../../domain/services/EmployeeMasterAccessService";
import { CalendarDate } from "../../domain/valueObjects/CalendarDate";
import { DateRange } from "../../domain/valueObjects/DateRange";
import { PeriodDivision } from "../../domain/valueObjects/PeriodDivision";
import { TermName } from "../../domain/valueObjects/TermName";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface SaveEvaluationPeriodRequest {
	/** 省略すると追加。指定すると、その評価期間の期の名前・日付・締め方を変える。 */
	periodId?: number;
	/** 期の名前(「26期」)。評価期間の名前は、期の名前と区切り(上期など)から決まる。 */
	termName: string;
	startDate: string;
	endDate: string;
	/** 追加するときの区切り方(full / half / quarter)。省略すると通年。変更では使わない。 */
	division?: string;
	/** 評価が確定していないシートが残っていても締めてよいか。省略すると false。 */
	allowUnfinalizedClose?: boolean;
}

export interface EvaluationPeriodChangeResponse {
	success: boolean;
	message: string;
}

const rangeOf = (request: Pick<SaveEvaluationPeriodRequest, "startDate" | "endDate">) => {
	if (!request.startDate || !request.endDate) {
		throw new DomainError("開始日と終了日を入力してください。");
	}
	return DateRange.of(CalendarDate.parse(request.startDate), CalendarDate.parse(request.endDate));
};

/** 追加する評価期間。期を区切り方どおりに分ける。決まりに反するときは DomainError。 */
export const planNewPeriods = (
	request: Omit<SaveEvaluationPeriodRequest, "periodId">,
): EvaluationPeriodPlan[] =>
	EvaluationTerm.of(
		TermName.from(request.termName),
		rangeOf(request),
		PeriodDivision.from(request.division ?? "full"),
	).divide(request.allowUnfinalizedClose ?? false);

/**
 * 評価期間を追加する(期を上期・下期などに分けて、まとめて追加できる)、または期の名前・日付・締め方を変える。
 * Admin だけが行える(DB側でも Admin 以外は拒否する)。
 * 実施中かどうかはここでは変わらない。追加した評価期間は締めた状態で始まり、期間締めで実施中になる。
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

		const calendar = new EvaluationCalendar(await this.periodRepository.findDistinctPeriods());
		const editing = request.periodId === undefined ? null : calendar.find(request.periodId);
		if (request.periodId !== undefined && !editing) {
			return reject("評価期間が見つかりませんでした。");
		}

		let plans: EvaluationPeriodPlan[];
		try {
			plans = editing
				? [
						editing.replan({
							term: TermName.from(request.termName),
							range: rangeOf(request),
							allowUnfinalizedClose: request.allowUnfinalizedClose ?? false,
						}),
					]
				: planNewPeriods(request);
		} catch (error) {
			if (error instanceof DomainError) {
				return reject(error.message);
			}
			throw error;
		}

		const taken = plans.find((plan) => calendar.hasPeriodNamed(plan.periodName, editing?.id));
		if (taken) {
			return reject(`「${taken.periodName}」という評価期間は既にあります。`);
		}

		const saved = editing
			? await this.periodRepository.update(editing.id, plans[0])
			: await this.periodRepository.create(plans);
		if (!saved) {
			return reject("評価期間を保存できませんでした。");
		}
		const names = plans.map(({ periodName }) => `「${periodName}」`).join("");
		outputPort.present({
			success: true,
			message: editing
				? `評価期間${names}を保存しました。`
				: `評価期間${names}を追加しました。開始するには、一覧の「この期間を開始する」を押してください。`,
		});
	}
}
