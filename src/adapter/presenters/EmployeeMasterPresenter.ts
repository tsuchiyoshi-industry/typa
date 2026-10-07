import { createSignal } from "solid-js";
import type { EmployeeMasterDto } from "../../application/dtos/EmployeeMasterDto";
import type {
	LoadEmployeeMasterOutputPort,
	LoadEmployeeMasterResponse,
} from "../../application/usecases/LoadEmployeeMasterInteractor";
import type { ResetEmployeeRegistrationOutputPort } from "../../application/usecases/ResetEmployeeRegistrationInteractor";
import type { UpdateEmployeeEvaluatorOutputPort } from "../../application/usecases/UpdateEmployeeEvaluatorInteractor";
import type { UpdateEmployeeGradeOutputPort } from "../../application/usecases/UpdateEmployeeGradeInteractor";
import type { UpdateEmployeeRoleOutputPort } from "../../application/usecases/UpdateEmployeeRoleInteractor";

export interface EmployeeMasterViewModel extends EmployeeMasterDto {
	loading: boolean;
	errorMessage: string | null;
	updateStatus: {
		message: string | null;
		success: boolean | null;
	};
}

export function createEmployeeMasterPresenter(): {
	viewModel: () => EmployeeMasterViewModel;
	outputPort: {
		load: LoadEmployeeMasterOutputPort;
		update: UpdateEmployeeEvaluatorOutputPort;
		updateGrade: UpdateEmployeeGradeOutputPort;
		updateRole: UpdateEmployeeRoleOutputPort;
		resetRegistration: ResetEmployeeRegistrationOutputPort;
	};
	beginLoad: () => void;
	presentError: (message: string) => void;
} {
	const [viewModel, setViewModel] = createSignal<EmployeeMasterViewModel>({
		loading: true,
		errorMessage: null,
		currentEmployee: null,
		mode: "employee",
		canEditEvaluators: false,
		canEditGrades: false,
		canEditRoles: false,
		canResetRegistrations: false,
		relations: [],
		grades: [],
		updateStatus: {
			message: null,
			success: null,
		},
	});

	const loadOutputPort: LoadEmployeeMasterOutputPort = {
		present(response: LoadEmployeeMasterResponse) {
			setViewModel((prev) => ({
				...prev,
				...response,
				loading: false,
				errorMessage: null,
			}));
		},
	};

	// 評価者・等級・権限・登録の取り消し、どの更新結果も同じ形で受け取る
	const updateOutputPort: UpdateEmployeeGradeOutputPort = {
		present(response) {
			setViewModel((prev) => ({
				...prev,
				updateStatus: {
					message: response.message,
					success: response.success,
				},
			}));
		},
	};

	const beginLoad = () => {
		setViewModel((prev) => ({ ...prev, loading: true, errorMessage: null }));
	};

	const presentError = (message: string) => {
		setViewModel((prev) => ({ ...prev, loading: false, errorMessage: message }));
	};

	return {
		viewModel,
		outputPort: {
			load: loadOutputPort,
			update: updateOutputPort,
			updateGrade: updateOutputPort,
			updateRole: updateOutputPort,
			resetRegistration: updateOutputPort,
		},
		beginLoad,
		presentError,
	};
}
