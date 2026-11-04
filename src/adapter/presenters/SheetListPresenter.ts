import { createSignal } from "solid-js";
import type { ExportSheetOutputDto } from "../../application/dtos/ExportSheetDto";
import type { CategorizedSheetsDto, SheetOverviewDto } from "../../application/dtos/SheetListDto";
import type { ExportEvaluationSheetOutputPort } from "../../application/usecases/ExportEvaluationSheetInteractor";
import type { FetchCategorizedSheetsOutputPort } from "../../application/usecases/FetchCategorizedSheetsInteractor";
import type { FetchDistinctPeriodsOutputPort } from "../../application/usecases/FetchDistinctPeriodsInteractor";
import type {
	FetchSheetIndexOutputPort,
	FetchSheetIndexResponse,
} from "../../application/usecases/FetchSheetIndexInteractor";
import type { FetchSheetOverviewOutputPort } from "../../application/usecases/FetchSheetOverviewInteractor";

/** 評価期間の読み込み結果。読めなかったときは presentUnavailable で知らせる。 */
export interface SheetListPeriodsOutputPort extends FetchDistinctPeriodsOutputPort {
	presentUnavailable(): void;
}

export type SheetIndex = NonNullable<FetchSheetIndexResponse["index"]>;

export interface SheetListViewModel {
	loading: boolean;
	/**
	 * 実施中の評価期間(シートを作れる期間)。読み込み前は undefined、読めなかったときは null。
	 * 新規作成を押せるかは、ここと自分のシートから決める。
	 */
	activePeriodIds?: number[] | null;
	mySheets: CategorizedSheetsDto["mySheets"];
	subordinateSheets: CategorizedSheetsDto["subordinateSheets"];
	/**
	 * 全社のシートの索引(評価期間のタブと件数に使う)。見られない人(Admin 以外)と、読み込み前は null。
	 */
	overviewIndex: SheetIndex | null;
	/** 全社の評価シート。読み込んだ評価期間のぶんだけ、評価期間の ID ごとに持つ。 */
	overviewSheets: Partial<Record<number, SheetOverviewDto[]>>;
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
	indexOutputPort: FetchSheetIndexOutputPort;
	periodsOutputPort: SheetListPeriodsOutputPort;
	exportOutputPort: ExportEvaluationSheetOutputPort;
	presentError: (message: string) => void;
} {
	const [viewModel, setViewModel] = createSignal<SheetListViewModel>({
		loading: true,
		mySheets: [],
		subordinateSheets: [],
		overviewIndex: null,
		overviewSheets: {},
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

	// 評価期間ごとにしまう。遅れて届いた別の期間の結果が、いま選んでいる期間の一覧を上書きしない
	const overviewOutputPort: FetchSheetOverviewOutputPort = {
		present({ periodId, sheets }) {
			if (sheets === null) {
				return;
			}
			setViewModel((prev) => ({
				...prev,
				overviewSheets: { ...prev.overviewSheets, [periodId]: sheets },
			}));
		},
	};

	const indexOutputPort: FetchSheetIndexOutputPort = {
		present({ index }) {
			setViewModel((prev) => ({ ...prev, overviewIndex: index }));
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
		indexOutputPort,
		periodsOutputPort,
		exportOutputPort,
		presentError,
	};
}
