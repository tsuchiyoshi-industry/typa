import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type {
	EvaluationSheetIndex,
	EvaluationSheetRepository,
} from "../../domain/repositories/EvaluationSheetRepository";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";
import { overviewViewer } from "./FetchSheetOverviewInteractor";

/** リクエストパラメータなし（空オブジェクトのみ許容） */
export type FetchSheetIndexRequest = Record<string, never>;

export interface FetchSheetIndexResponse {
	/** 全社のシートの評価期間と社員。見られない人(Admin 以外)には null。 */
	index: EvaluationSheetIndex | null;
}

export interface FetchSheetIndexOutputPort extends OutputPort<FetchSheetIndexResponse> {}

/**
 * 全社のシートの索引を、見てよい人(Admin)にだけ読む。評価期間の切り替えと件数に使い、
 * シートの中身は評価期間を選んでから FetchSheetOverviewInteractor で読む。
 */
export class FetchSheetIndexInteractor
	implements UseCase<FetchSheetIndexRequest, FetchSheetIndexOutputPort>
{
	constructor(
		private readonly employeeMasterRepository: EmployeeMasterRepository,
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
	) {}

	async execute(_request: FetchSheetIndexRequest, outputPort: FetchSheetIndexOutputPort): Promise<void> {
		const viewer = await overviewViewer(this.employeeMasterRepository);
		outputPort.present({
			index: viewer ? await this.evaluationSheetRepository.findOverviewIndex() : null,
		});
	}
}
