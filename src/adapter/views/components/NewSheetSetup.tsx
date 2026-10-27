import { A } from "@solidjs/router";
import CalendarDays from "lucide-solid/icons/calendar-days";
import { type Component, createMemo, For, Show } from "solid-js";
import { creatablePeriods, type SheetEditorViewModel } from "../../presenters/SheetEditorPresenter";

interface NewSheetSetupProps {
	viewModel: SheetEditorViewModel;
	onSelectPeriod: (periodId: number | null) => void;
	onCreate: () => void;
}

/** 評価期間を選んで、自分の評価シートを作る。 */
const NewSheetSetup: Component<NewSheetSetupProps> = (props) => {
	/** 実施中の期間のシートがすべて作成済みなら、そのシート(いちばん新しい期間のもの)。 */
	const alreadyCreated = createMemo(() => {
		const vm = props.viewModel;
		if (vm.loadingAccessibleSheets || vm.periods.length === 0 || creatablePeriods(vm).length > 0) {
			return null;
		}
		return vm.accessibleSheets.mySheets.find((mine) => mine.periodId === vm.periods[0]?.id) ?? null;
	});

	return (
		<div class="new-sheet-setup">
			<h2>評価期間を選んで作成</h2>
			<Show when={props.viewModel.fetchError}>
				<p class="error-message" role="alert">
					{props.viewModel.fetchError}
				</p>
			</Show>
			<Show when={alreadyCreated()}>
				{(existing) => (
					<p class="page-note" role="status">
						実施中の評価期間の評価シートは作成済みです。
						<A href={`/sheet/${existing().id}`}>作成済みのシートを開く</A>
					</p>
				)}
			</Show>
			<div class="period-picker">
				<label for="period-select">
					<CalendarDays class="select-icon" />
					評価対象期間
				</label>
				<select
					id="period-select"
					value={props.viewModel.selectedPeriodId ?? ""}
					onChange={(e) => props.onSelectPeriod(Number(e.currentTarget.value) || null)}
				>
					<option value="" disabled>
						期間を選択してください
					</option>
					<For each={creatablePeriods(props.viewModel)}>
						{(period) => <option value={period.id}>{period.periodName}</option>}
					</For>
				</select>
			</div>
			<button
				type="button"
				class="create-sheet-button"
				onClick={() => props.onCreate()}
				disabled={
					props.viewModel.creating ||
					props.viewModel.loadingAccessibleSheets ||
					props.viewModel.selectedPeriodId == null
				}
			>
				{props.viewModel.creating ? "作成中..." : "評価シートを作成"}
			</button>
			<Show when={props.viewModel.createError}>
				<p class="error-message" role="alert">
					{props.viewModel.createError}
				</p>
			</Show>
		</div>
	);
};

export default NewSheetSetup;
