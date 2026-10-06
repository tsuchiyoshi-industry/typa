import type { EmployeeMapDto } from "../../application/dtos/EmployeeMapDto";
import type { LoadEmployeeMapInteractor } from "../../application/usecases/LoadEmployeeMapInteractor";

export class EmployeeMapController {
	constructor(private readonly useCase: LoadEmployeeMapInteractor) {}
	async load(): Promise<EmployeeMapDto> {
		let response: EmployeeMapDto | undefined;
		await this.useCase.execute(
			{},
			{
				present: (result) => {
					response = result;
				},
			},
		);
		if (!response) {
			throw new Error("マップを取得できませんでした。");
		}
		return response;
	}
}
