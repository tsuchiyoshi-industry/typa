import { EvaluationCalendar } from "../../domain/entities/EvaluationCalendar";
import { describePeriodError, type PeriodError } from "../../domain/entities/PeriodError";
import { err, ok, type Result } from "../../domain/Result";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { EvaluationPeriodRepository } from "../../domain/repositories/EvaluationPeriodRepository";
import { canEditSettings } from "../../domain/services/EmployeeMasterAccessService";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import { type EvaluationPeriodDto, toEvaluationPeriodDto } from "../dtos/EvaluationPeriodDto";
import type { OutputPort } from "../ports/OutputPort";
import type { FallibleUseCase } from "../ports/UseCase";

export interface CloseEvaluationPeriodRequest {
	/** 締める期間。画面で実施中と見ていた期間で、もう実施中でなければ締めない。 */
	periodId: number;
	/** false なら、締められるかを確かめるだけで何も変えない(確認ダイアログを出す前に使う)。 */
	confirmed: boolean;
}

export type CloseEvaluationPeriodResponse =
	| { status: "rejected"; message: string }
	/** 締められる。まだ何も変えていない。 */
	| {
			status: "ready";
			closing: EvaluationPeriodDto;
			/** 締めた後に準備中になる評価期間。開始できる評価期間がまだ無ければ null。 */
			preparing: EvaluationPeriodDto | null;
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
	| { kind: "periodNotFound" }
	/** 画面で見ていた期間が、もう実施中でない(別の Admin が先に締めたなど)。 */
	| { kind: "notActive"; periodName: string }
	| { kind: "closeFailed" };

export function describeCloseEvaluationPeriodError(error: CloseEvaluationPeriodError): string {
	switch (error.kind) {
		case "forbidden":
			return "評価期間を締められるのは Admin のみです。";
		case "periodNotFound":
			return "評価期間が見つかりませんでした。";
		case "notActive":
			return `「${error.periodName}」は実施中ではないため、締められません。画面を開き直してください。`;
		case "closeFailed":
			return "評価期間を締められませんでした。";
		default:
			return describePeriodError(error);
	}
}

/**
 * 締め。実施中の評価期間を締める。次の評価期間は開始せず、準備中になる(EvaluationCalendar.close)。
 * 未確定の評価シートが1枚でも残っていると締められない(Admin が認めた評価期間は締められる)。締めた期間のシートは
 * 誰も変更できなくなる。Admin だけが行える(DB側でも同じ条件で拒否し、監査に記録する)。
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
		const closing = calendar.find(request.periodId);
		if (!closing) {
			return err({ kind: "periodNotFound" });
		}
		if (!closing.isActive) {
			return err({ kind: "notActive", periodName: closing.periodName });
		}
		const sheets = await this.periodRepository.countSheetsByStatus(closing.id);
		const closed = calendar.close(sheets);
		if (!closed.ok) {
			return closed;
		}
		const preparing = closed.value.preparing();

		if (!request.confirmed) {
			outputPort.present({
				status: "ready",
				closing: toEvaluationPeriodDto(closing),
				preparing: preparing && toEvaluationPeriodDto(preparing),
				finalizedSheets: sheets.of(EvaluationStatus.FINALIZED),
				unfinishedSheets: sheets.unfinished(),
			});
			return ok(undefined);
		}

		if (!(await this.periodRepository.close(closing.id))) {
			return err({ kind: "closeFailed" });
		}
		outputPort.present({
			status: "closed",
			message: preparing
				? `「${closing.periodName}」を締めました。「${preparing.periodName}」は準備中です。等級の変更などを済ませてから開始してください。`
				: `「${closing.periodName}」を締めました。次に開始する評価期間はまだありません。評価期間を追加してから開始してください。`,
		});
		return ok(undefined);
	}
}
