import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import { canEditGrades } from "../../domain/services/EmployeeMasterAccessService";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface UpdateEmployeeGradeRequest {
	targetEmployeeNo: string;
	gradeId: number;
}

export interface UpdateEmployeeGradeResponse {
	success: boolean;
	message: string;
}

export interface UpdateEmployeeGradeOutputPort extends OutputPort<UpdateEmployeeGradeResponse> {}

export class UpdateEmployeeGradeInteractor
	implements UseCase<UpdateEmployeeGradeRequest, UpdateEmployeeGradeOutputPort>
{
	constructor(private readonly employeeMasterRepository: EmployeeMasterRepository) {}

	async execute(
		request: UpdateEmployeeGradeRequest,
		outputPort: UpdateEmployeeGradeOutputPort,
	): Promise<void> {
		const targetEmployeeNo = request.targetEmployeeNo.trim();

		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee || !canEditGrades(currentEmployee.roleName)) {
			outputPort.present({ success: false, message: "等級を更新する権限がありません。" });
			return;
		}

		const target = targetEmployeeNo
			? await this.employeeMasterRepository.findByEmployeeNo(targetEmployeeNo)
			: null;
		const grade = (await this.employeeMasterRepository.findGrades()).find(
			(item) => item.id === request.gradeId,
		);
		if (!target || !grade) {
			outputPort.present({ success: false, message: "対象社員または等級が見つかりませんでした。" });
			return;
		}

		const updatedProfile = await this.employeeMasterRepository.updateGradeByEmployeeNo(
			targetEmployeeNo,
			grade.id,
		);

		outputPort.present({
			success: updatedProfile !== null,
			message:
				updatedProfile !== null
					? `${updatedProfile.name}さんの等級を${grade.name}に更新しました。`
					: "等級の更新に失敗しました。",
		});
	}
}
