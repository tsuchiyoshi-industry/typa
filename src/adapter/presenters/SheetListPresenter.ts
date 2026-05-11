import { createSignal } from "solid-js";
import type { CategorizedSheetsDto } from "../../application/dtos/SheetListDto";
import type { FetchCategorizedSheetsOutputPort } from "../../application/usecases/FetchCategorizedSheetsInteractor";

export interface SheetListViewModel {
	loading: boolean;
	mySheets: CategorizedSheetsDto["mySheets"];
	subordinateSheets: CategorizedSheetsDto["subordinateSheets"];
	errorMessage: string | null;
}

export function createSheetListPresenter(): {
	viewModel: () => SheetListViewModel;
	outputPort: FetchCategorizedSheetsOutputPort;
	presentError: (message: string) => void;
} {
	const [viewModel, setViewModel] = createSignal<SheetListViewModel>({
		loading: true,
		mySheets: [],
		subordinateSheets: [],
		errorMessage: null,
	});

	const outputPort: FetchCategorizedSheetsOutputPort = {
		present(response) {
			setViewModel({
				loading: false,
				mySheets: response.mySheets,
				subordinateSheets: response.subordinateSheets,
				errorMessage: null,
			});
		},
	};

	const presentError = (message: string) => {
		setViewModel((prev) => ({ ...prev, loading: false, errorMessage: message }));
	};

	return { viewModel, outputPort, presentError };
}
