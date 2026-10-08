import { createSignal } from "solid-js";
import type { ExportSheetOutputDto } from "../../application/dtos/ExportSheetDto";
import type { CategorizedSheetsDto, SheetOverviewDto } from "../../application/dtos/SheetListDto";
import type { ExportEvaluationSheetOutputPort } from "../../application/usecases/ExportEvaluationSheetInteractor";
import type { FetchCategorizedSheetsOutputPort } from "../../application/usecases/FetchCategorizedSheetsInteractor";
import type { FetchSheetOverviewOutputPort } from "../../application/usecases/FetchSheetOverviewInteractor";

export interface SheetListViewModel {
	loading: boolean;
	mySheets: CategorizedSheetsDto["mySheets"];
	subordinateSheets: CategorizedSheetsDto["subordinateSheets"];
	/** 全社の評価シート。見られない人(Admin 以外)は null。 */
	overviewSheets: SheetOverviewDto[] | null;
	errorMessage: string | null;
	exportStatus: {
		isExporting: boolean;
		message: string | null;
		success: boolean | null;
		fileName: string | null;
	};
}

export function createSheetListPresenter(): {
	viewModel: () => SheetListViewModel;
	fetchOutputPort: FetchCategorizedSheetsOutputPort;
	overviewOutputPort: FetchSheetOverviewOutputPort;
	exportOutputPort: ExportEvaluationSheetOutputPort;
	presentError: (message: string) => void;
} {
	const [viewModel, setViewModel] = createSignal<SheetListViewModel>({
		loading: true,
		mySheets: [],
		subordinateSheets: [],
		overviewSheets: null,
		errorMessage: null,
		exportStatus: {
			isExporting: false,
			message: null,
			success: null,
			fileName: null,
		},
	});

	const fetchOutputPort: FetchCategorizedSheetsOutputPort = {
		present(response) {
			setViewModel((prev) => ({
				...prev,
				loading: false,
				mySheets: response.mySheets,
				subordinateSheets: response.subordinateSheets,
				errorMessage: null,
				exportStatus: {
					isExporting: false,
					message: null,
					success: null,
					fileName: null,
				},
			}));
		},
	};

	const overviewOutputPort: FetchSheetOverviewOutputPort = {
		present(response) {
			setViewModel((prev) => ({ ...prev, overviewSheets: response.sheets }));
		},
	};

	const exportOutputPort: ExportEvaluationSheetOutputPort = {
		present(response: ExportSheetOutputDto) {
			setViewModel((prev) => ({
				...prev,
				exportStatus: {
					isExporting: false,
					message: response.message,
					success: response.success,
					fileName: response.fileName ?? null,
				},
			}));
		},
	};

	const presentError = (message: string) => {
		setViewModel((prev) => ({ ...prev, loading: false, errorMessage: message }));
	};

	return { viewModel, fetchOutputPort, overviewOutputPort, exportOutputPort, presentError };
}
