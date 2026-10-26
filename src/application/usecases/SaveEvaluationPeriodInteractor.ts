import { EvaluationCalendar } from "../../domain/entities/EvaluationCalendar";
import type { EvaluationPeriodPlan } from "../../domain/entities/EvaluationPeriodPlan";
import { EvaluationTerm } from "../../domain/entities/EvaluationTerm";
import { describePeriodError, type PeriodError } from "../../domain/entities/PeriodError";
import { err, ok, type Result } from "../../domain/Result";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { EvaluationPeriodRepository } from "../../domain/repositories/EvaluationPeriodRepository";
import { canEditSettings } from "../../domain/services/EmployeeMasterAccessService";
import { CalendarDate } from "../../domain/valueObjects/CalendarDate";
import { DateRange } from "../../domain/valueObjects/DateRange";
import { PeriodDivision } from "../../domain/valueObjects/PeriodDivision";
import { TermName } from "../../domain/valueObjects/TermName";
import type { OutputPort } from "../ports/OutputPort";
import type { FallibleUseCase } from "../ports/UseCase";

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

export type SaveEvaluationPeriodError =
	| PeriodError
	| { kind: "forbidden" }
	| { kind: "periodNotFound" }
	| { kind: "periodNameTaken"; periodName: string }
	| { kind: "saveFailed" };

export function describeSaveEvaluationPeriodError(error: SaveEvaluationPeriodError): string {
	switch (error.kind) {
		case "forbidden":
			return "評価期間を変更できるのは Admin のみです。";
		case "periodNotFound":
			return "評価期間が見つかりませんでした。";
		case "periodNameTaken":
			return `「${error.periodName}」という評価期間は既にあります。`;
		case "saveFailed":
			return "評価期間を保存できませんでした。";
		default:
			return describePeriodError(error);
	}
}

const rangeOf = (
	request: Pick<SaveEvaluationPeriodRequest, "startDate" | "endDate">,
): Result<DateRange, PeriodError> => {
	if (!request.startDate || !request.endDate) {
		return err({ kind: "datesMissing" });
	}
	const start = CalendarDate.parse(request.startDate);
	if (!start.ok) {
		return start;
	}
	const end = CalendarDate.parse(request.endDate);
	if (!end.ok) {
		return end;
	}
	return DateRange.of(start.value, end.value);
};

/** 追加する評価期間。期を区切り方どおりに分ける。 */
export const planNewPeriods = (
	request: Omit<SaveEvaluationPeriodRequest, "periodId">,
): Result<EvaluationPeriodPlan[], PeriodError> => {
	const term = TermName.from(request.termName);
	if (!term.ok) {
		return term;
	}
	const range = rangeOf(request);
	if (!range.ok) {
		return range;
	}
	const division = PeriodDivision.from(request.division ?? "full");
	if (!division.ok) {
		return division;
	}
	const evaluationTerm = EvaluationTerm.of(term.value, range.value, division.value);
	return evaluationTerm.ok
		? ok(evaluationTerm.value.divide(request.allowUnfinalizedClose ?? false))
		: evaluationTerm;
};

/**
 * 評価期間を追加する(期を上期・下期などに分けて、まとめて追加できる)、または期の名前・日付・締め方を変える。
 * Admin だけが行える(DB側でも Admin 以外は拒否する)。
 * 実施中かどうかはここでは変わらない。追加した評価期間は締めた状態で始まり、期間締めで実施中になる。
 */
export class SaveEvaluationPeriodInteractor
	implements
		FallibleUseCase<
			SaveEvaluationPeriodRequest,
			OutputPort<EvaluationPeriodChangeResponse>,
			SaveEvaluationPeriodError
		>
{
	constructor(
		private readonly periodRepository: EvaluationPeriodRepository,
		private readonly employeeMasterRepository: EmployeeMasterRepository,
	) {}

	async execute(
		request: SaveEvaluationPeriodRequest,
		outputPort: OutputPort<EvaluationPeriodChangeResponse>,
	): Promise<Result<void, SaveEvaluationPeriodError>> {
		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee || !canEditSettings(currentEmployee.role)) {
			return err({ kind: "forbidden" });
		}

		const calendar = new EvaluationCalendar(await this.periodRepository.findDistinctPeriods());
		const editing = request.periodId === undefined ? null : calendar.find(request.periodId);
		if (request.periodId !== undefined && !editing) {
			return err({ kind: "periodNotFound" });
		}

		let plans: EvaluationPeriodPlan[];
		if (editing) {
			const term = TermName.from(request.termName);
			if (!term.ok) {
				return term;
			}
			const range = rangeOf(request);
			if (!range.ok) {
				return range;
			}
			plans = [
				editing.replan({
					term: term.value,
					range: range.value,
					allowUnfinalizedClose: request.allowUnfinalizedClose ?? false,
				}),
			];
		} else {
			const planned = planNewPeriods(request);
			if (!planned.ok) {
				return planned;
			}
			plans = planned.value;
		}

		const taken = plans.find((plan) => calendar.hasPeriodNamed(plan.periodName, editing?.id));
		if (taken) {
			return err({ kind: "periodNameTaken", periodName: taken.periodName });
		}

		const saved = editing
			? await this.periodRepository.update(editing.id, plans[0])
			: await this.periodRepository.create(plans);
		if (!saved) {
			return err({ kind: "saveFailed" });
		}
		const names = plans.map(({ periodName }) => `「${periodName}」`).join("");
		outputPort.present({
			success: true,
			message: editing
				? `評価期間${names}を保存しました。`
				: `評価期間${names}を追加しました。開始するには、一覧の「この期間を開始する」を押してください。`,
		});
		return ok(undefined);
	}
}
