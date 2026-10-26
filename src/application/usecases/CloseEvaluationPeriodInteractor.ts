import { EvaluationCalendar } from "../../domain/entities/EvaluationCalendar";
import { describePeriodError, type PeriodError } from "../../domain/entities/PeriodError";
import { err, ok, type Result } from "../../domain/Result";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { EvaluationPeriodRepository } from "../../domain/repositories/EvaluationPeriodRepository";
import { canEditSettings } from "../../domain/services/EmployeeMasterAccessService";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import { SheetCountsByStatus } from "../../domain/valueObjects/SheetCountsByStatus";
import { type EvaluationPeriodDto, toEvaluationPeriodDto } from "../dtos/EvaluationPeriodDto";
import type { OutputPort } from "../ports/OutputPort";
import type { FallibleUseCase } from "../ports/UseCase";

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
			/** 評価が確定していないまま締めるシートの枚数(締める期間が認めているときだけ 0 より大きい)。 */
			unfinishedSheets: number;
	  }
	| { status: "closed"; message: string };

type CloseEvaluationPeriodSuccess = Exclude<CloseEvaluationPeriodResponse, { status: "rejected" }>;

export type CloseEvaluationPeriodError =
	| PeriodError
	| { kind: "forbidden" }
	| { kind: "nextPeriodNotFound" }
	| { kind: "activateFailed" };

export function describeCloseEvaluationPeriodError(error: CloseEvaluationPeriodError): string {
	switch (error.kind) {
		case "forbidden":
			return "評価期間を締められるのは Admin のみです。";
		case "nextPeriodNotFound":
			return "評価期間が見つかりませんでした。";
		case "activateFailed":
			return "評価期間を切り替えられませんでした。";
		default:
			return describePeriodError(error);
	}
}

/**
 * 期間締め。次の期間を実施中にし、いま実施中の期間を同時に締める(実施中の期間は常に1つ)。
 * 締める期間に未確定の評価シートが1枚でも残っていると締められない(Admin が認めた評価期間は締められる)。締めた期間のシートは
 * 誰も変更できなくなる。Admin だけが行える(DB側でも同じ条件で拒否する)。
 * 開始できるのは未開始の評価期間だけで、締めた評価期間をもう一度開始することはできない。
 */
export class CloseEvaluationPeriodInteractor
	implements
		FallibleUseCase<
			CloseEvaluationPeriodRequest,
			OutputPort<CloseEvaluationPeriodSuccess>,
			CloseEvaluationPeriodError
		>
{
	constructor(
		private readonly periodRepository: EvaluationPeriodRepository,
		private readonly employeeMasterRepository: EmployeeMasterRepository,
	) {}

	async execute(
		request: CloseEvaluationPeriodRequest,
		outputPort: OutputPort<CloseEvaluationPeriodSuccess>,
	): Promise<Result<void, CloseEvaluationPeriodError>> {
		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee || !canEditSettings(currentEmployee.role)) {
			return err({ kind: "forbidden" });
		}

		const calendar = new EvaluationCalendar(await this.periodRepository.findDistinctPeriods());
		const next = calendar.find(request.nextPeriodId);
		if (!next) {
			return err({ kind: "nextPeriodNotFound" });
		}
		const closing = calendar.active();
		const sheets = closing
			? await this.periodRepository.countSheetsByStatus(closing.id)
			: SheetCountsByStatus.NONE;
		const canStart = next.startable();
		if (!canStart.ok) {
			return canStart;
		}
		const canClose = closing?.closable(sheets);
		if (canClose && !canClose.ok) {
			return canClose;
		}

		if (!request.confirmed) {
			outputPort.present({
				status: "ready",
				closing: closing && toEvaluationPeriodDto(closing),
				next: toEvaluationPeriodDto(next),
				finalizedSheets: sheets.of(EvaluationStatus.FINALIZED),
				unfinishedSheets: sheets.unfinished(),
			});
			return ok(undefined);
		}

		if (!(await this.periodRepository.activate(next.id))) {
			return err({ kind: "activateFailed" });
		}
		outputPort.present({
			status: "closed",
			message: closing
				? `「${closing.periodName}」を締め、「${next.periodName}」を開始しました。`
				: `「${next.periodName}」を開始しました。`,
		});
		return ok(undefined);
	}
}
