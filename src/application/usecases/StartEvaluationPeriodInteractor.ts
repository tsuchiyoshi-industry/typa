import { EvaluationCalendar } from "../../domain/entities/EvaluationCalendar";
import { describePeriodError, type PeriodError } from "../../domain/entities/PeriodError";
import { err, ok, type Result } from "../../domain/Result";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { EvaluationPeriodRepository } from "../../domain/repositories/EvaluationPeriodRepository";
import { canEditSettings } from "../../domain/services/EmployeeMasterAccessService";
import { type EvaluationPeriodDto, toEvaluationPeriodDto } from "../dtos/EvaluationPeriodDto";
import type { OutputPort } from "../ports/OutputPort";
import type { FallibleUseCase } from "../ports/UseCase";

export interface StartEvaluationPeriodRequest {
	/** 開始する期間。準備中の評価期間だけを開始できる。 */
	periodId: number;
	/** false なら、開始できるかを確かめるだけで何も変えない(確認ダイアログを出す前に使う)。 */
	confirmed: boolean;
}

export type StartEvaluationPeriodResponse =
	| { status: "rejected"; message: string }
	/** 開始できる。まだ何も変えていない。 */
	| { status: "ready"; next: EvaluationPeriodDto }
	| { status: "started"; message: string };

type StartEvaluationPeriodSuccess = Exclude<StartEvaluationPeriodResponse, { status: "rejected" }>;

export type StartEvaluationPeriodError =
	| PeriodError
	| { kind: "forbidden" }
	| { kind: "startFailed" };

export function describeStartEvaluationPeriodError(error: StartEvaluationPeriodError): string {
	switch (error.kind) {
		case "forbidden":
			return "評価期間を開始できるのは Admin のみです。";
		case "startFailed":
			return "評価期間を開始できませんでした。";
		default:
			return describePeriodError(error);
	}
}

/**
 * 開始。準備中の評価期間を実施中にする(EvaluationCalendar.start)。実施中の評価期間がある間は開始せず、
 * 先に締める。締めた評価期間をもう一度開始することもない。Admin だけが行える(DB側でも同じ条件で拒否し、監査に記録する)。
 */
export class StartEvaluationPeriodInteractor
	implements
		FallibleUseCase<
			StartEvaluationPeriodRequest,
			OutputPort<StartEvaluationPeriodSuccess>,
			StartEvaluationPeriodError
		>
{
	constructor(
		private readonly periodRepository: EvaluationPeriodRepository,
		private readonly employeeMasterRepository: EmployeeMasterRepository,
	) {}

	async execute(
		request: StartEvaluationPeriodRequest,
		outputPort: OutputPort<StartEvaluationPeriodSuccess>,
	): Promise<Result<void, StartEvaluationPeriodError>> {
		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee || !canEditSettings(currentEmployee.role)) {
			return err({ kind: "forbidden" });
		}

		const calendar = new EvaluationCalendar(await this.periodRepository.findDistinctPeriods());
		const started = calendar.start(request.periodId);
		if (!started.ok) {
			return started;
		}
		const next = calendar.find(request.periodId);
		if (!next) {
			return err({ kind: "periodNotFound" });
		}

		if (!request.confirmed) {
			outputPort.present({ status: "ready", next: toEvaluationPeriodDto(next) });
			return ok(undefined);
		}

		if (!(await this.periodRepository.activate(next.id))) {
			return err({ kind: "startFailed" });
		}
		outputPort.present({ status: "started", message: `「${next.periodName}」を開始しました。` });
		return ok(undefined);
	}
}
