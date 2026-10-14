import { createSignal } from "solid-js";
import type { UpsertCommonEvaluationOutputPort } from "../../application/usecases/UpsertCommonEvaluationInteractor";

/** 共通評価の保存の結果。表示する項目と結果は、シートと一緒に読み込まれる。 */
export interface CommonEvaluationViewModel {
	updateError: string | null;
}

export function createCommonEvaluationPresenter(): {
	viewModel: () => CommonEvaluationViewModel;
	outputPort: {
		upsert: UpsertCommonEvaluationOutputPort;
	};
	presentUpsertError: (message: string) => void;
} {
	const [viewModel, setViewModel] = createSignal<CommonEvaluationViewModel>({ updateError: null });

	return {
		viewModel,
		outputPort: {
			upsert: {
				present() {
					setViewModel({ updateError: null });
				},
			},
		},
		presentUpsertError: (message: string) => setViewModel({ updateError: message }),
	};
}
