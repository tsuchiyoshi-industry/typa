import { createSignal } from "solid-js";
import type { EvaluationPeriodDto } from "../../application/dtos/EvaluationPeriodDto";
import type { EvaluationSheetDto } from "../../application/dtos/EvaluationSheetDto";
import type { CategorizedSheetsDto } from "../../application/dtos/SheetListDto";
import type { CheckEvaluatorRoleOutputPort } from "../../application/usecases/CheckEvaluatorRoleInteractor";
import type {
	CreateEvaluationSheetOutputPort,
	CreateEvaluationSheetResponse,
} from "../../application/usecases/CreateEvaluationSheetInteractor";
import type { FetchCategorizedSheetsOutputPort } from "../../application/usecases/FetchCategorizedSheetsInteractor";
import type {
	FetchDistinctPeriodsOutputPort,
	FetchDistinctPeriodsResponse,
} from "../../application/usecases/FetchDistinctPeriodsInteractor";
import type {
	FetchEvaluationSheetOutputPort,
	FetchEvaluationSheetResponse,
} from "../../application/usecases/FetchEvaluationSheetInteractor";
import type {
	UpdateEvaluationStatusOutputPort,
	UpdateEvaluationStatusResponse,
} from "../../application/usecases/UpdateEvaluationStatusInteractor";
import type {
	UpdateFinalEvaluationRankOutputPort,
	UpdateFinalEvaluationRankResponse,
} from "../../application/usecases/UpdateFinalEvaluationRankInteractor";
import type {
	UpdateOverallCommentOutputPort,
	UpdateOverallCommentResponse,
} from "../../application/usecases/UpdateOverallCommentInteractor";

export interface SheetEditorViewModel {
	loadingSheet: boolean;
	sheet: EvaluationSheetDto | null;
	loadingAccessibleSheets: boolean;
	accessibleSheets: CategorizedSheetsDto;
	periods: EvaluationPeriodDto[];
	selectedPeriodId: number | null;
	isSubject: boolean;
	canEditFirst: boolean;
	canEditSecond: boolean;
	canEditMilestoneGoal: boolean;
	canViewCommonEvaluation: boolean;
	canViewSecondEvaluation: boolean;
	canSubmitOwnSheet: boolean;
	canRevertOwnSheetToDraft: boolean;
	canFinalizeAsSecondaryEvaluator: boolean;
	updatingOverallComment: boolean;
	overallCommentUpdateError: string | null;
	updatingFinalEvaluationRank: boolean;
	finalEvaluationRankUpdateError: string | null;
	updatingStatus: boolean;
	statusUpdateError: string | null;
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
		accessibleSheets: FetchCategorizedSheetsOutputPort;
		overallComment: UpdateOverallCommentOutputPort;
		finalEvaluationRank: UpdateFinalEvaluationRankOutputPort;
		status: UpdateEvaluationStatusOutputPort;
	};
	beginSheetLoad: () => void;
	beginAccessibleSheetsLoad: () => void;
	prepareNewSheet: () => void;
	setSelectedPeriodId: (id: number | null) => void;
	presentSheetError: (message: string) => void;
	presentAccessibleSheetsError: (message: string) => void;
	presentPeriodsError: (message: string) => void;
	presentCreateError: (message: string) => void;
	presentRoleError: (message: string) => void;
	beginOverallCommentUpdate: () => void;
	presentOverallCommentUpdateError: (message: string) => void;
	beginFinalEvaluationRankUpdate: () => void;
	presentFinalEvaluationRankUpdateError: (message: string) => void;
	beginStatusUpdate: () => void;
	presentStatusUpdateError: (message: string) => void;
} {
	const [viewModel, setViewModel] = createSignal<SheetEditorViewModel>({
		loadingSheet: true,
		sheet: null,
		loadingAccessibleSheets: false,
		accessibleSheets: {
			mySheets: [],
			subordinateSheets: [],
		},
		periods: [],
		selectedPeriodId: null,
		isSubject: false,
		canEditFirst: false,
		canEditSecond: false,
		canEditMilestoneGoal: false,
		canViewCommonEvaluation: false,
		canViewSecondEvaluation: false,
		canSubmitOwnSheet: false,
		canRevertOwnSheetToDraft: false,
		canFinalizeAsSecondaryEvaluator: false,
		updatingOverallComment: false,
		overallCommentUpdateError: null,
		updatingFinalEvaluationRank: false,
		finalEvaluationRankUpdateError: null,
		updatingStatus: false,
		statusUpdateError: null,
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
				overallCommentUpdateError: null,
				finalEvaluationRankUpdateError: null,
			}));
		},
	};

	const accessibleSheetsOutputPort: FetchCategorizedSheetsOutputPort = {
		present(response) {
			setViewModel((prev) => ({
				...prev,
				loadingAccessibleSheets: false,
				accessibleSheets: {
					mySheets: response.mySheets,
					subordinateSheets: response.subordinateSheets,
				},
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
				isSubject: response.isSubject,
				canEditFirst: response.canEditFirst,
				canEditSecond: response.canEditSecond,
				canEditMilestoneGoal: response.canEditMilestoneGoal,
				canViewCommonEvaluation: response.canViewCommonEvaluation,
				canViewSecondEvaluation: response.canViewSecondEvaluation,
				canSubmitOwnSheet: response.canSubmitOwnSheet,
				canRevertOwnSheetToDraft: response.canRevertOwnSheetToDraft,
				canFinalizeAsSecondaryEvaluator: response.canFinalizeAsSecondaryEvaluator,
			}));
		},
	};

	const overallCommentOutputPort: UpdateOverallCommentOutputPort = {
		present(response: UpdateOverallCommentResponse) {
			setViewModel((prev) => ({
				...prev,
				sheet: response.sheet,
				updatingOverallComment: false,
				overallCommentUpdateError: null,
			}));
		},
	};

	const finalEvaluationRankOutputPort: UpdateFinalEvaluationRankOutputPort = {
		present(response: UpdateFinalEvaluationRankResponse) {
			setViewModel((prev) => ({
				...prev,
				sheet: response.sheet,
				updatingFinalEvaluationRank: false,
				finalEvaluationRankUpdateError: null,
			}));
		},
	};

	const statusOutputPort: UpdateEvaluationStatusOutputPort = {
		present(response: UpdateEvaluationStatusResponse) {
			setViewModel((prev) => ({
				...prev,
				sheet: response.sheet,
				updatingStatus: false,
				statusUpdateError: null,
			}));
		},
	};

	const presentSheetError = (message: string) => {
		setViewModel((prev) => ({ ...prev, loadingSheet: false, fetchError: message }));
	};

	const presentAccessibleSheetsError = (message: string) => {
		setViewModel((prev) => ({
			...prev,
			loadingAccessibleSheets: false,
			fetchError: message,
		}));
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

	const beginOverallCommentUpdate = () => {
		setViewModel((prev) => ({
			...prev,
			updatingOverallComment: true,
			overallCommentUpdateError: null,
		}));
	};

	const beginFinalEvaluationRankUpdate = () => {
		setViewModel((prev) => ({
			...prev,
			updatingFinalEvaluationRank: true,
			finalEvaluationRankUpdateError: null,
		}));
	};

	const presentFinalEvaluationRankUpdateError = (message: string) => {
		setViewModel((prev) => ({
			...prev,
			updatingFinalEvaluationRank: false,
			finalEvaluationRankUpdateError: message,
		}));
	};

	const presentOverallCommentUpdateError = (message: string) => {
		setViewModel((prev) => ({
			...prev,
			updatingOverallComment: false,
			overallCommentUpdateError: message,
		}));
	};

	const beginStatusUpdate = () => {
		setViewModel((prev) => ({
			...prev,
			updatingStatus: true,
			statusUpdateError: null,
		}));
	};

	const presentStatusUpdateError = (message: string) => {
		setViewModel((prev) => ({
			...prev,
			updatingStatus: false,
			statusUpdateError: message,
		}));
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
			overallCommentUpdateError: null,
			finalEvaluationRankUpdateError: null,
		}));
	};

	const beginAccessibleSheetsLoad = () => {
		setViewModel((prev) => ({
			...prev,
			loadingAccessibleSheets: true,
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
			accessibleSheets: accessibleSheetsOutputPort,
			overallComment: overallCommentOutputPort,
			finalEvaluationRank: finalEvaluationRankOutputPort,
			status: statusOutputPort,
		},
		beginSheetLoad,
		beginAccessibleSheetsLoad,
		prepareNewSheet,
		setSelectedPeriodId,
		presentSheetError,
		presentAccessibleSheetsError,
		presentPeriodsError,
		presentCreateError,
		presentRoleError,
		beginOverallCommentUpdate,
		presentOverallCommentUpdateError,
		beginFinalEvaluationRankUpdate,
		presentFinalEvaluationRankUpdateError,
		beginStatusUpdate,
		presentStatusUpdateError,
	};
}
