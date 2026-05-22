import { useNavigate, useParams } from "@solidjs/router";
import { CalendarDays, FileText, Users } from "lucide-solid";
import { type Component, createEffect, createMemo, For, Show } from "solid-js";
import type { SheetSummaryDto } from "../../application/dtos/SheetListDto";
import type { ChallengeEvaluationController } from "../controllers/ChallengeEvaluationController";
import type { CommonEvaluationController } from "../controllers/CommonEvaluationController";
import type { SheetEditorController } from "../controllers/SheetEditorController";
import type { ChallengeEvaluationViewModel } from "../presenters/ChallengeEvaluationPresenter";
import type { CommonEvaluationViewModel } from "../presenters/CommonEvaluationPresenter";
import type { SheetEditorViewModel } from "../presenters/SheetEditorPresenter";
import ChallengeEvaluationView from "./components/ChallengeEvaluationView";
import CommonEvaluationView from "./components/CommonEvaluationView";

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
	let skipNextRouteSheetId: number | null = null;

	createEffect(() => {
		if (isNew()) {
			props.controller.prepareNewSheet();
			void props.controller.loadPeriods();
			return;
		}

		const sheetId = Number(idParam());
		if (!Number.isNaN(sheetId)) {
			if (skipNextRouteSheetId === sheetId) {
				skipNextRouteSheetId = null;
				return;
			}
			void props.controller.loadPeriods();
			void props.controller.loadAccessibleSheets();
			void props.controller.loadSheet(sheetId);
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

	const toSubjectOption = (sheet: SheetSummaryDto) => ({
		sheetId: sheet.id,
		periodId: sheet.periodId,
		employeeId: sheet.employeeId,
		employeeName: sheet.employeeName,
		employeeNo: sheet.employeeNo,
	});

	const dedupeSubjectOptions = (sheets: SheetSummaryDto[]) => {
		const seen = new Set<string>();
		return sheets
			.filter((item) => item.periodId === sheet()?.evaluationPeriod?.id)
			.map(toSubjectOption)
			.filter((item) => {
				if (seen.has(item.employeeNo)) {
					return false;
				}
				seen.add(item.employeeNo);
				return true;
			});
	};

	const mySubjectOptions = createMemo(() =>
		dedupeSubjectOptions(viewModel().accessibleSheets.mySheets),
	);

	const subordinateSubjectOptions = createMemo(() =>
		dedupeSubjectOptions(viewModel().accessibleSheets.subordinateSheets),
	);

	const formatSubjectOption = (name: string, employeeNo: string) => `${name}（${employeeNo}）`;

	const handleSubjectChange = async (employeeNo: string) => {
		const currentSheet = sheet();
		if (!currentSheet?.subject || employeeNo === currentSheet.subject.employeeNo) {
			return;
		}

		const loadedSheetId = await props.controller.loadSheet(currentSheet.sheetId, employeeNo);
		if (loadedSheetId != null && loadedSheetId !== currentSheet.sheetId) {
			skipNextRouteSheetId = loadedSheetId;
			navigate(`/sheet/${loadedSheetId}`, { replace: true });
		}
	};

	const EditorManagementHeader = () => (
		<section class="editor-management-header">
			<div class="editor-management-title">
				<Users class="editor-management-icon" />
				<div>
					<h2>表示対象社員</h2>
					<p>{sheet()?.evaluationPeriod?.periodName ?? "評価期間未設定"}</p>
				</div>
			</div>
			<label class="subject-selector" for="subject-select">
				<span>社員</span>
				<select
					id="subject-select"
					value={sheet()?.subject?.employeeNo ?? ""}
					disabled={viewModel().loadingAccessibleSheets}
					onChange={(event) => void handleSubjectChange(event.currentTarget.value)}
				>
					<Show when={mySubjectOptions().length > 0}>
						<option disabled>自分</option>
						<For each={mySubjectOptions()}>
							{(item) => (
								<option value={item.employeeNo}>
									{formatSubjectOption(item.employeeName, item.employeeNo)}
								</option>
							)}
						</For>
					</Show>
					<Show when={subordinateSubjectOptions().length > 0}>
						<option disabled>──────────</option>
						<option disabled>部下</option>
						<For each={subordinateSubjectOptions()}>
							{(item) => (
								<option value={item.employeeNo}>
									{formatSubjectOption(item.employeeName, item.employeeNo)}
								</option>
							)}
						</For>
					</Show>
					<Show
						when={
							mySubjectOptions().length === 0 &&
							subordinateSubjectOptions().length === 0 &&
							sheet()?.subject
						}
					>
						<option value={sheet()?.subject?.employeeNo ?? ""}>
							{formatSubjectOption(
								sheet()?.subject?.name ?? "未設定",
								sheet()?.subject?.employeeNo ?? "未設定",
							)}
						</option>
					</Show>
				</select>
			</label>
		</section>
	);

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
				<EditorManagementHeader />
				<ProfileCards />
				<ChallengeEvaluationView
					sheetId={sheetId() ?? null}
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
					<Show when={viewModel().fetchError}>
						<p class="error-message">{viewModel().fetchError}</p>
					</Show>
					{renderSheetContent()}
				</Show>
			</Show>
		</div>
	);
};

export default SheetEditorView;
