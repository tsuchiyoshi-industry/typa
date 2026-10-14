import { createSignal } from "solid-js";
import type { EvaluationPeriodDto } from "../../application/dtos/EvaluationPeriodDto";
import {
	type EvaluationSheetDto,
	NO_SHEET_PERMISSIONS,
	type SheetPermissionsDto,
} from "../../application/dtos/EvaluationSheetDto";
import type { CategorizedSheetsDto } from "../../application/dtos/SheetListDto";
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
	UpdateOverallCommentOutputPort,
	UpdateOverallCommentResponse,
} from "../../application/usecases/UpdateOverallCommentInteractor";
import { showToast } from "../views/feedback";

export interface SheetEditorViewModel extends SheetPermissionsDto {
	loadingSheet: boolean;
	sheet: EvaluationSheetDto | null;
	loadingAccessibleSheets: boolean;
	accessibleSheets: CategorizedSheetsDto;
	periods: EvaluationPeriodDto[];
	selectedPeriodId: number | null;
	updatingOverallComment: boolean;
	overallCommentUpdateError: string | null;
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
		accessibleSheets: FetchCategorizedSheetsOutputPort;
		overallComment: UpdateOverallCommentOutputPort;
		status: UpdateEvaluationStatusOutputPort;
	};
	beginSheetLoad: (silent?: boolean) => void;
	beginAccessibleSheetsLoad: () => void;
	prepareNewSheet: () => void;
	setSelectedPeriodId: (id: number | null) => void;
	presentSheetError: (message: string) => void;
	presentAccessibleSheetsError: (message: string) => void;
	presentPeriodsError: (message: string) => void;
	presentCreateError: (message: string) => void;
	beginOverallCommentUpdate: () => void;
	presentOverallCommentUpdateError: (message: string) => void;
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
		...NO_SHEET_PERMISSIONS,
		updatingOverallComment: false,
		overallCommentUpdateError: null,
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
				...response.permissions,
				createdSheetId: null,
				fetchError: null,
				overallCommentUpdateError: null,
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
				// 評価シートを作成できるのは、実施中の評価期間だけ
				periods: response.periods.filter((period) => period.isActive),
				selectedPeriodId:
					prev.selectedPeriodId ?? response.periods.find((period) => period.isActive)?.id ?? null,
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

	const overallCommentOutputPort: UpdateOverallCommentOutputPort = {
		present(response: UpdateOverallCommentResponse) {
			setViewModel((prev) => ({
				...prev,
				sheet: response.sheet,
				...response.sheet.permissions,
				updatingOverallComment: false,
				overallCommentUpdateError: null,
			}));
		},
	};

	const statusOutputPort: UpdateEvaluationStatusOutputPort = {
		present(response: UpdateEvaluationStatusResponse) {
			setViewModel((prev) => ({
				...prev,
				sheet: response.sheet,
				...response.sheet.permissions,
				updatingStatus: false,
				statusUpdateError: null,
			}));
		},
		// 送信が終わる頃には別のシートや画面に移っていることがあるので、画面に依らないトーストで知らせる
		presentNotificationDelivery({ recipient, error }) {
			if (error) {
				showToast("error", `${recipient}に通知メールを送信できませんでした`, error);
			} else {
				showToast("success", `${recipient}に通知メールを送信しました`);
			}
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

	const beginOverallCommentUpdate = () => {
		setViewModel((prev) => ({
			...prev,
			updatingOverallComment: true,
			overallCommentUpdateError: null,
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

	/** silent: 保存後の再取得。表示中のシートを残したまま裏で読み直す(画面を消さない)。 */
	const beginSheetLoad = (silent = false) => {
		setViewModel((prev) => ({
			...prev,
			...(silent
				? {}
				: {
						loadingSheet: true,
						sheet: null,
						...NO_SHEET_PERMISSIONS,
						// 別のシートを開いたら、前のシートの確定時の警告は持ち越さない
						statusUpdateError: null,
					}),
			fetchError: null,
			overallCommentUpdateError: null,
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
			accessibleSheets: accessibleSheetsOutputPort,
			overallComment: overallCommentOutputPort,
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
		beginOverallCommentUpdate,
		presentOverallCommentUpdateError,
		beginStatusUpdate,
		presentStatusUpdateError,
	};
}
