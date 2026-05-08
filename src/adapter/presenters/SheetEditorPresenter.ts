import { createSignal } from "solid-js";
import type { EvaluationPeriodDto } from "../../application/dtos/EvaluationPeriodDto";
import type { EvaluationSheetDto } from "../../application/dtos/EvaluationSheetDto";
import type { CheckEvaluatorRoleOutputPort } from "../../application/usecases/CheckEvaluatorRoleInteractor";
import type {
	CreateEvaluationSheetOutputPort,
	CreateEvaluationSheetResponse,
} from "../../application/usecases/CreateEvaluationSheetInteractor";
import type {
	FetchDistinctPeriodsOutputPort,
	FetchDistinctPeriodsResponse,
} from "../../application/usecases/FetchDistinctPeriodsInteractor";
import type {
	FetchEvaluationSheetOutputPort,
	FetchEvaluationSheetResponse,
} from "../../application/usecases/FetchEvaluationSheetInteractor";

export interface SheetEditorViewModel {
	loadingSheet: boolean;
	sheet: EvaluationSheetDto | null;
	periods: EvaluationPeriodDto[];
	selectedPeriodId: number | null;
	canEditFirst: boolean;
	canEditSecond: boolean;
	creating: boolean;
	createdSheetId: number | null;
	createError: string | null;
	fetchError: string | null;
}

export function createSheetEditorPresenter(): {
	viewModel: () => SheetEditorViewModel;
	outputPort: {
		sheet: FetchEvaluationSheetOutputPort;
		periods: FetchDistinctPeriodsOutputPort;
		createSheet: CreateEvaluationSheetOutputPort;
		role: CheckEvaluatorRoleOutputPort;
	};
	beginSheetLoad: () => void;
	prepareNewSheet: () => void;
	setSelectedPeriodId: (id: number | null) => void;
	presentSheetError: (message: string) => void;
	presentPeriodsError: (message: string) => void;
	presentCreateError: (message: string) => void;
	presentRoleError: (message: string) => void;
} {
	const [viewModel, setViewModel] = createSignal<SheetEditorViewModel>({
		loadingSheet: true,
		sheet: null,
		periods: [],
		selectedPeriodId: null,
		canEditFirst: false,
		canEditSecond: false,
		creating: false,
		createdSheetId: null,
		createError: null,
		fetchError: null,
	});

	const sheetOutputPort: FetchEvaluationSheetOutputPort = {
		present(response: FetchEvaluationSheetResponse) {
			setViewModel((prev) => ({
				...prev,
				loadingSheet: false,
				sheet: response,
				createdSheetId: null,
				fetchError: null,
			}));
		},
	};

	const periodsOutputPort: FetchDistinctPeriodsOutputPort = {
		present(response: FetchDistinctPeriodsResponse) {
			setViewModel((prev) => ({
				...prev,
				periods: response.periods,
				selectedPeriodId: prev.selectedPeriodId ?? response.periods[0]?.id ?? null,
			}));
		},
	};

	const createSheetOutputPort: CreateEvaluationSheetOutputPort = {
		present(response: CreateEvaluationSheetResponse) {
			setViewModel((prev) => ({
				...prev,
				creating: false,
				createdSheetId: response.sheetId,
				createError: null,
			}));
		},
	};

	const roleOutputPort: CheckEvaluatorRoleOutputPort = {
		present(response) {
			setViewModel((prev) => ({
				...prev,
				canEditFirst: response.canEditFirst,
				canEditSecond: response.canEditSecond,
			}));
		},
	};

	const presentSheetError = (message: string) => {
		setViewModel((prev) => ({ ...prev, loadingSheet: false, fetchError: message }));
	};

	const presentPeriodsError = (message: string) => {
		setViewModel((prev) => ({ ...prev, fetchError: message }));
	};

	const presentCreateError = (message: string) => {
		setViewModel((prev) => ({
			...prev,
			creating: false,
			createError: message,
			createdSheetId: null,
		}));
	};

	const presentRoleError = (message: string) => {
		setViewModel((prev) => ({ ...prev, fetchError: message }));
	};

	const setSelectedPeriodId = (id: number | null) => {
		setViewModel((prev) => ({ ...prev, selectedPeriodId: id }));
	};

	const beginSheetLoad = () => {
		setViewModel((prev) => ({
			...prev,
			loadingSheet: true,
			sheet: null,
			fetchError: null,
		}));
	};

	/** /sheet/new … シート取得なしでフォームを出す */
	const prepareNewSheet = () => {
		setViewModel((prev) => ({
			...prev,
			loadingSheet: false,
			sheet: null,
			fetchError: null,
		}));
	};

	return {
		viewModel,
		outputPort: {
			sheet: sheetOutputPort,
			periods: periodsOutputPort,
			createSheet: createSheetOutputPort,
			role: roleOutputPort,
		},
		beginSheetLoad,
		prepareNewSheet,
		setSelectedPeriodId,
		presentSheetError,
		presentPeriodsError,
		presentCreateError,
		presentRoleError,
	};
}
