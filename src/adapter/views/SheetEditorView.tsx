import { useNavigate, useParams } from "@solidjs/router";
import { CalendarDays, FileText } from "lucide-solid";
import { type Component, createEffect, createMemo, Show } from "solid-js";
import type { ChallengeEvaluationController } from "../controllers/ChallengeEvaluationController";
import type { CommonEvaluationController } from "../controllers/CommonEvaluationController";
import type { SheetEditorController } from "../controllers/SheetEditorController";
import type { ChallengeEvaluationViewModel } from "../presenters/ChallengeEvaluationPresenter";
import type { CommonEvaluationViewModel } from "../presenters/CommonEvaluationPresenter";
import type { SheetEditorViewModel } from "../presenters/SheetEditorPresenter";
import ChallengeEvaluationView from "./ChallengeEvaluationView";
import CommonEvaluationView from "./CommonEvaluationView";

interface SheetEditorViewProps {
	controller: SheetEditorController;
	viewModel: () => SheetEditorViewModel;
	commonEvaluationController: CommonEvaluationController;
	commonEvaluationViewModel: () => CommonEvaluationViewModel;
	challengeEvaluationController: ChallengeEvaluationController;
	challengeEvaluationViewModel: () => ChallengeEvaluationViewModel;
}

const SheetEditorView: Component<SheetEditorViewProps> = (props) => {
	const params = useParams();
	const navigate = useNavigate();
	const idParam = createMemo(() => params.id ?? "");
	const isNew = createMemo(() => idParam() === "new");
	const viewModel = props.viewModel;

	const sheet = createMemo(() => viewModel().sheet);
	const sheetId = createMemo(() => sheet()?.sheetId);
	const canEditFirst = createMemo(() => viewModel().canEditFirst);
	const canEditSecond = createMemo(() => viewModel().canEditSecond);

	createEffect(() => {
		if (isNew()) {
			props.controller.prepareNewSheet();
			void props.controller.loadPeriods();
			return;
		}

		const sheetId = Number(idParam());
		if (!Number.isNaN(sheetId)) {
			props.controller.loadPeriods();
			props.controller.loadSheet(sheetId);
		}
	});

	createEffect(() => {
		const createdSheetId = viewModel().createdSheetId;
		if (createdSheetId != null) {
			navigate(`/sheet/${createdSheetId}`);
		}
	});

	createEffect(() => {
		const sheet = viewModel().sheet;
		if (sheet?.subject) {
			props.controller.loadRoles(sheet.subject);
		}
	});

	const handleCreateSheet = async () => {
		const newSheetId = await props.controller.createSheet([]);
		if (newSheetId) {
			navigate(`/sheet/${newSheetId}`);
		}
	};

	const reloadCurrentSheetFromRoute = () => {
		const id = Number(idParam());
		if (!Number.isNaN(id)) {
			void props.controller.loadSheet(id);
		}
	};

	const ProfileCards = () => (
		<section class="profile-cards">
			<div class="profile-card">
				<h3>評価対象者</h3>
				<p>{sheet()?.subject?.name ?? "未設定"}</p>
				<p>社員番号: {sheet()?.subject?.employeeNo ?? "未設定"}</p>
				<p>等級: {sheet()?.subject?.gradeName ?? "未設定"}</p>
			</div>
			<div class="profile-card">
				<h3>評価期間</h3>
				<p>{sheet()?.evaluationPeriod?.periodName ?? "未設定"}</p>
				<p>
					{sheet()?.evaluationPeriod?.startDate ?? ""} - {sheet()?.evaluationPeriod?.endDate ?? ""}
				</p>
			</div>
			<div class="profile-card">
				<h3>評価者</h3>
				<p>一次評価: {sheet()?.primaryEvaluator ?? "未設定"}</p>
				<p>二次評価: {sheet()?.secondaryEvaluator ?? "未設定"}</p>
			</div>
		</section>
	);

	const renderSheetContent = () => {
		const currentSheet = sheet();
		if (currentSheet?.subject == null) {
			return <p>データを取得できませんでした。</p>;
		}

		return (
			<>
				<ProfileCards />
				<ChallengeEvaluationView
					objectives={currentSheet.objectives ?? []}
					subject={currentSheet.subject}
					canEditFirst={canEditFirst()}
					canEditSecond={canEditSecond()}
					controller={props.challengeEvaluationController}
					viewModel={props.challengeEvaluationViewModel}
					onUpdated={reloadCurrentSheetFromRoute}
				/>
				<CommonEvaluationView
					sheetId={sheetId() ?? null}
					gradeId={currentSheet.subject.gradeId}
					canEditFirst={canEditFirst()}
					canEditSecond={canEditSecond()}
					controller={props.commonEvaluationController}
					viewModel={props.commonEvaluationViewModel}
					onUpdated={reloadCurrentSheetFromRoute}
				/>
			</>
		);
	};

	return (
		<div class="dashboard-page">
			<header class="dashboard-header">
				<h1>
					<FileText class="header-icon" />
					{isNew() ? "新規評価シート" : "評価シート"}
				</h1>
			</header>

			<Show when={!viewModel().loadingSheet} fallback={<p>シート情報を読み込み中です...</p>}>
				<Show
					when={!isNew()}
					fallback={
						<div class="new-sheet-setup">
							<h2>新規評価シートの作成</h2>
							<Show when={viewModel().fetchError}>
								<p class="error-message">{viewModel().fetchError}</p>
							</Show>
							<div class="period-picker">
								<label for="period-select">
									<CalendarDays class="select-icon" />
									評価対象期間
								</label>
								<select
									id="period-select"
									value={viewModel().selectedPeriodId ?? ""}
									onChange={(e) =>
										props.controller.setSelectedPeriod(Number(e.currentTarget.value) || null)
									}
								>
									<option value="" disabled>
										期間を選択してください
									</option>
									{viewModel().periods.map((period) => (
										<option value={period.id}>{period.periodName}</option>
									))}
								</select>
							</div>
							<button
								type="button"
								class="create-sheet-button"
								onClick={handleCreateSheet}
								disabled={viewModel().creating || viewModel().selectedPeriodId == null}
							>
								{viewModel().creating ? "作成中..." : "評価シートを作成"}
							</button>
							<Show when={viewModel().createError}>
								<p class="error-message">{viewModel().createError}</p>
							</Show>
						</div>
					}
				>
					{renderSheetContent()}
				</Show>
			</Show>
		</div>
	);
};

export default SheetEditorView;
