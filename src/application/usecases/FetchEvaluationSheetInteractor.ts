import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import { canViewAllSheets } from "../../domain/services/EmployeeMasterAccessService";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import type { EvaluationSheetDto } from "../dtos/EvaluationSheetDto";
import { toEvaluationSheetDto } from "../dtos/EvaluationSheetMapper";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface FetchEvaluationSheetRequest {
	sheetId: number;
	currentEmployeeId: number | null;
}

export interface FetchEvaluationSheetResponse extends EvaluationSheetDto {}

export interface FetchEvaluationSheetOutputPort extends OutputPort<FetchEvaluationSheetResponse> {}

export class FetchEvaluationSheetInteractor
	implements UseCase<FetchEvaluationSheetRequest, FetchEvaluationSheetOutputPort>
{
	constructor(
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
		private readonly employeeRepository: EmployeeRepository,
		private readonly employeeMasterRepository: EmployeeMasterRepository,
	) {}

	async execute(
		request: FetchEvaluationSheetRequest,
		outputPort: FetchEvaluationSheetOutputPort,
	): Promise<void> {
		const sheet = await this.evaluationSheetRepository.findById(request.sheetId);
		// 無いシートも、読む権限の無いシートも、DB からは同じく見えない。空の下書きを作って見せない
		if (!sheet) {
			throw new Error("評価シートが見つかりません。");
		}

		let policy = EvaluationSheetAccessPolicy.for(request.currentEmployeeId, sheet);
		// 関わらないシートを開いたときだけ、全社のシートを見られる人(Admin)かを確かめる。
		// 本人・評価者として開く普段の閲覧では問い合わせない
		if (!policy.canViewSheet()) {
			const viewer = await this.employeeMasterRepository.findCurrentEmployeeProfile();
			if (viewer && canViewAllSheets(viewer.role)) {
				policy = EvaluationSheetAccessPolicy.for(request.currentEmployeeId, sheet, true);
			}
		}
		if (!policy.canViewSheet()) {
			throw new Error("評価シートを閲覧する権限がありません。");
		}
		const gradeName = await this.employeeRepository.findGradeName(sheet.gradeId);
		outputPort.present(toEvaluationSheetDto(sheet, gradeName, policy));
	}
}
