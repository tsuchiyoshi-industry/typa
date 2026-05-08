import { createSignal } from "solid-js";
import type { ExportSheetOutputDto } from "../../application/dtos/ExportSheetDto";
import type { CategorizedSheetsDto } from "../../application/dtos/SheetListDto";
import type { ExportEvaluationSheetOutputPort } from "../../application/usecases/ExportEvaluationSheetInteractor";
import type { FetchCategorizedSheetsOutputPort } from "../../application/usecases/FetchCategorizedSheetsInteractor";

export interface SheetListViewModel {
	loading: boolean;
	mySheets: CategorizedSheetsDto["mySheets"];
	subordinateSheets: CategorizedSheetsDto["subordinateSheets"];
	errorMessage: string | null;
	exportStatus: {
		isExporting: boolean;
		message: string | null;
		success: boolean | null;
	};
}

export function createSheetListPresenter(): {
	viewModel: () => SheetListViewModel;
	fetchOutputPort: FetchCategorizedSheetsOutputPort;
	exportOutputPort: ExportEvaluationSheetOutputPort;
	presentError: (message: string) => void;
} {
	const [viewModel, setViewModel] = createSignal<SheetListViewModel>({
		loading: true,
		mySheets: [],
		subordinateSheets: [],
		errorMessage: null,
		exportStatus: {
			isExporting: false,
			message: null,
			success: null,
		},
	});

	const fetchOutputPort: FetchCategorizedSheetsOutputPort = {
		present(response) {
			setViewModel({
				loading: false,
				mySheets: response.mySheets,
				subordinateSheets: response.subordinateSheets,
				errorMessage: null,
				exportStatus: {
					isExporting: false,
					message: null,
					success: null,
				},
			});
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
				},
			}));

			// 3秒後にメッセージをクリア
			setTimeout(() => {
				setViewModel((prev) => ({
					...prev,
					exportStatus: {
						isExporting: false,
						message: null,
						success: null,
					},
				}));
			}, 3000);
		},
	};

	const presentError = (message: string) => {
		setViewModel((prev) => ({ ...prev, loading: false, errorMessage: message }));
	};

	return { viewModel, fetchOutputPort, exportOutputPort, presentError };
}
