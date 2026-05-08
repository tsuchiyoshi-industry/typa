import { createSignal } from "solid-js";
import type {
	UpdateMilestoneOutputPort,
	UpdateMilestoneResponse,
} from "../../application/usecases/UpdateMilestoneInteractor";

export interface ChallengeEvaluationViewModel {
	updating: boolean;
	updateError: string | null;
	updatedMilestoneId: number | null;
}

export function createChallengeEvaluationPresenter(): {
	viewModel: () => ChallengeEvaluationViewModel;
	outputPort: UpdateMilestoneOutputPort;
	presentUpdateError: (message: string) => void;
} {
	const [viewModel, setViewModel] = createSignal<ChallengeEvaluationViewModel>({
		updating: false,
		updateError: null,
		updatedMilestoneId: null,
	});

	const outputPort: UpdateMilestoneOutputPort = {
		present(response: UpdateMilestoneResponse) {
			setViewModel({
				updating: false,
				updateError: null,
				updatedMilestoneId: response.milestone.id,
			});
		},
	};

	const presentUpdateError = (message: string) => {
		setViewModel({ updating: false, updateError: message, updatedMilestoneId: null });
	};

	return { viewModel, outputPort, presentUpdateError };
}
