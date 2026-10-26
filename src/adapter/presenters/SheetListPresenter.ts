import { createSignal } from "solid-js";
import type { ExportSheetOutputDto } from "../../application/dtos/ExportSheetDto";
import type { CategorizedSheetsDto, SheetOverviewDto } from "../../application/dtos/SheetListDto";
import type { ExportEvaluationSheetOutputPort } from "../../application/usecases/ExportEvaluationSheetInteractor";
import type { FetchCategorizedSheetsOutputPort } from "../../application/usecases/FetchCategorizedSheetsInteractor";
import type { FetchDistinctPeriodsOutputPort } from "../../application/usecases/FetchDistinctPeriodsInteractor";
import type { FetchSheetOverviewOutputPort } from "../../application/usecases/FetchSheetOverviewInteractor";

/** 評価期間の読み込み結果。読めなかったときは presentUnavailable で知らせる。 */
export interface SheetListPeriodsOutputPort extends FetchDistinctPeriodsOutputPort {
	presentUnavailable(): void;
}

export interface SheetListViewModel {
	loading: boolean;
	/**
	 * 実施中の評価期間(シートを作れる期間)。読み込み前は undefined、読めなかったときは null。
	 * 新規作成を押せるかは、ここと自分のシートから決める。
	 */
	activePeriodIds?: number[] | null;
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
	periodsOutputPort: SheetListPeriodsOutputPort;
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

	const periodsOutputPort: SheetListPeriodsOutputPort = {
		present(response) {
			setViewModel((prev) => ({
				...prev,
				activePeriodIds: response.periods
					.filter((period) => period.isActive)
					.map((period) => period.id),
			}));
		},
		presentUnavailable() {
			setViewModel((prev) => ({ ...prev, activePeriodIds: null }));
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

	return {
		viewModel,
		fetchOutputPort,
		overviewOutputPort,
		periodsOutputPort,
		exportOutputPort,
		presentError,
	};
}
