import { createSignal } from "solid-js";
import type { CommonEvaluationSummaryDto } from "../../application/dtos/CommonEvaluationDto";
import type { LoadCommonEvaluationOutputPort } from "../../application/usecases/LoadCommonEvaluationInteractor";
import type { UpsertCommonEvaluationOutputPort } from "../../application/usecases/UpsertCommonEvaluationInteractor";

export interface CommonEvaluationViewModel {
	loading: boolean;
	summary: CommonEvaluationSummaryDto | null;
	loadError: string | null;
	updating: boolean;
	updateError: string | null;
	lastUpdatedSheetId: number | null;
}

export function createCommonEvaluationPresenter(): {
	viewModel: () => CommonEvaluationViewModel;
	outputPort: {
		load: LoadCommonEvaluationOutputPort;
		upsert: UpsertCommonEvaluationOutputPort;
	};
	beginLoad: () => void;
	presentLoadError: (message: string) => void;
	presentUpsertError: (message: string) => void;
} {
	const [viewModel, setViewModel] = createSignal<CommonEvaluationViewModel>({
		loading: true,
		summary: null,
		loadError: null,
		updating: false,
		updateError: null,
		lastUpdatedSheetId: null,
	});

	const outputPort: LoadCommonEvaluationOutputPort = {
		present(response) {
			setViewModel({
				loading: false,
				summary: response,
				loadError: null,
				updating: false,
				updateError: null,
				lastUpdatedSheetId: null,
			});
		},
	};

	const upsertOutputPort: UpsertCommonEvaluationOutputPort = {
		present(response) {
			setViewModel((prev) => ({
				...prev,
				updating: false,
				updateError: null,
				lastUpdatedSheetId: response.sheetId,
			}));
		},
	};

	const beginLoad = () => {
		setViewModel((prev) => ({ ...prev, loading: true, loadError: null }));
	};

	const presentLoadError = (message: string) => {
		setViewModel((prev) => ({ ...prev, loading: false, loadError: message }));
	};

	const presentUpsertError = (message: string) => {
		setViewModel((prev) => ({ ...prev, updating: false, updateError: message }));
	};

	return {
		viewModel,
		outputPort: {
			load: outputPort,
			upsert: upsertOutputPort,
		},
		beginLoad,
		presentLoadError,
		presentUpsertError,
	};
}
