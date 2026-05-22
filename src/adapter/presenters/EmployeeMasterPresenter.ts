import { createSignal } from "solid-js";
import type { EmployeeMasterDto } from "../../application/dtos/EmployeeMasterDto";
import type { AssignEvaluatorOutputPort } from "../../application/usecases/AssignEvaluatorInteractor";
import type {
	LoadEmployeeMasterOutputPort,
	LoadEmployeeMasterResponse,
} from "../../application/usecases/LoadEmployeeMasterInteractor";
import type { UpdateEmployeeEvaluatorOutputPort } from "../../application/usecases/UpdateEmployeeEvaluatorInteractor";

export interface EmployeeMasterViewModel extends EmployeeMasterDto {
	loading: boolean;
	errorMessage: string | null;
	assignmentStatus: {
		message: string | null;
		success: boolean | null;
	};
}

export function createEmployeeMasterPresenter(): {
	viewModel: () => EmployeeMasterViewModel;
	outputPort: {
		load: LoadEmployeeMasterOutputPort;
		assign: AssignEvaluatorOutputPort;
		update: UpdateEmployeeEvaluatorOutputPort;
	};
	beginLoad: () => void;
	presentError: (message: string) => void;
	clearAssignmentStatus: () => void;
} {
	const [viewModel, setViewModel] = createSignal<EmployeeMasterViewModel>({
		loading: true,
		errorMessage: null,
		currentEmployee: null,
		mode: "employee",
		canAssignEvaluators: false,
		canViewAllRelations: false,
		relations: [],
		assignmentStatus: {
			message: null,
			success: null,
		},
	});

	const loadOutputPort: LoadEmployeeMasterOutputPort = {
		present(response: LoadEmployeeMasterResponse) {
			setViewModel((prev) => ({
				...prev,
				loading: false,
				errorMessage: null,
				currentEmployee: response.currentEmployee,
				mode: response.mode,
				canAssignEvaluators: response.canAssignEvaluators,
				canViewAllRelations: response.canViewAllRelations,
				relations: response.relations,
			}));
		},
	};

	const assignOutputPort: AssignEvaluatorOutputPort = {
		present(response) {
			setViewModel((prev) => ({
				...prev,
				assignmentStatus: {
					message: response.message,
					success: response.success,
				},
			}));
		},
	};

	const updateOutputPort: UpdateEmployeeEvaluatorOutputPort = {
		present(response) {
			setViewModel((prev) => ({
				...prev,
				assignmentStatus: {
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

	const clearAssignmentStatus = () => {
		setViewModel((prev) => ({
			...prev,
			assignmentStatus: {
				message: null,
				success: null,
			},
		}));
	};

	return {
		viewModel,
		outputPort: {
			load: loadOutputPort,
			assign: assignOutputPort,
			update: updateOutputPort,
		},
		beginLoad,
		presentError,
		clearAssignmentStatus,
	};
}
