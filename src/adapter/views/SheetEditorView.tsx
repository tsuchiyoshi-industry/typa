import { useNavigate, useParams } from "@solidjs/router";
import { Award, CalendarDays, FileText, User, Users } from "lucide-solid";
import { type Component, createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { SheetSummaryDto } from "../../application/dtos/SheetListDto";
import {
	FINAL_EVALUATION_RANK_LETTERS,
	FINAL_EVALUATION_RANK_LEVEL_SYMBOLS,
	FINAL_EVALUATION_RANK_LEVELS,
} from "../../domain/valueObjects/FinalEvaluationRank";
import type { ChallengeEvaluationController } from "../controllers/ChallengeEvaluationController";
import type { CommonEvaluationController } from "../controllers/CommonEvaluationController";
import type { SheetEditorController } from "../controllers/SheetEditorController";
import type { ChallengeEvaluationViewModel } from "../presenters/ChallengeEvaluationPresenter";
import type { CommonEvaluationViewModel } from "../presenters/CommonEvaluationPresenter";
import type { SheetEditorViewModel } from "../presenters/SheetEditorPresenter";
import ChallengeEvaluationView from "./components/ChallengeEvaluationView";
import CommonEvaluationView from "./components/CommonEvaluationView";
import EvaluationStatusToggle from "./components/EvaluationStatusToggle";
import OverallCommentSection from "./components/OverallCommentSectionView";

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
	const [firstOverallDraft, setFirstOverallDraft] = createSignal("");
	const [secondOverallDraft, setSecondOverallDraft] = createSignal("");
	const finalRankOptions = createMemo(() =>
		FINAL_EVALUATION_RANK_LETTERS.flatMap((letter) =>
			FINAL_EVALUATION_RANK_LEVELS.map((level) => ({
				letter,
				level,
				value: `${letter}|${level}`,
				label: `${letter}${FINAL_EVALUATION_RANK_LEVEL_SYMBOLS[level]}`,
			})),
		),
	);
	const selectedFinalRankValue = createMemo(() => {
		const finalEvaluationRank = sheet()?.finalEvaluationRank;
		if (!finalEvaluationRank) {
			return "";
		}
		return `${finalEvaluationRank.letter}|${finalEvaluationRank.level}`;
	});

	createEffect(() => {
		if (isNew()) {
			props.controller.prepareNewSheet();
			void props.controller.loadPeriods();
			return;
		}

		const sheetId = Number(idParam());
		if (!Number.isNaN(sheetId)) {
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
		const currentSheet = sheet();
		if (currentSheet?.sheetId) {
			props.controller.loadRoles(currentSheet.sheetId);
		}
	});

	createEffect(() => {
		const currentSheet = sheet();
		setFirstOverallDraft(currentSheet?.firstOverallComment ?? "");
		setSecondOverallDraft(currentSheet?.secondOverallComment ?? "");
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

	const handleStatusChange = async (status: "draft" | "submitted") => {
		const success = await props.controller.updateStatus(status);
		if (success) {
			reloadCurrentSheetFromRoute();
		}
	};

	const handleFinalize = async () => {
		const success = await props.controller.updateStatus("submitted", true);
		if (success) {
			reloadCurrentSheetFromRoute();
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

	// 数値版のIDを用意（比較やAPI呼び出しに利用）
	const numericId = createMemo(() => Number(idParam()));

	// --- handleSubjectChange の修正 ---
	const handleSubjectChange = (selectedSheetId: number) => {
		const currentSheet = sheet();
		// 型が一致するのでエラーが出なくなり、ロジックも正確になります
		if (!currentSheet?.subject || selectedSheetId === numericId()) {
			return;
		}

		navigate(`/sheet/${selectedSheetId}`);
	};

	const EditorManagementHeader = () => {
		let selectRef: HTMLSelectElement | undefined;

		const isCurrentIdInList = createMemo(() => {
			const id = idParam();
			return (
				mySubjectOptions().some((o) => String(o.sheetId) === id) ||
				subordinateSubjectOptions().some((o) => String(o.sheetId) === id)
			);
		});

		// optionリストが変わった後、命令的にvalueを強制セット
		createEffect(() => {
			const id = idParam();
			// isCurrentIdInList()を購読して、option追加後に再実行させる
			isCurrentIdInList();
			mySubjectOptions();
			subordinateSubjectOptions();

			if (selectRef) {
				selectRef.value = id;
			}
		});

		return (
			<div class="editor-management-header">
				<Users class="editor-management-icon" />
				<select
					ref={selectRef}
					id="subject-select"
					class="subject-select"
					disabled={viewModel().loadingAccessibleSheets || viewModel().loadingSheet}
					onChange={(event) => handleSubjectChange(Number(event.currentTarget.value))}
				>
					<Show when={mySubjectOptions().length > 0}>
						<option disabled>自分</option>
						<For each={mySubjectOptions()}>
							{(item) => (
								<option value={String(item.sheetId)}>
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
								<option value={String(item.sheetId)}>
									{formatSubjectOption(item.employeeName, item.employeeNo)}
								</option>
							)}
						</For>
					</Show>

					<Show when={!isCurrentIdInList()}>
						<option value={idParam()}>
							{(() => {
								const currentSheet = sheet();
								const subject = currentSheet?.subject;
								return subject
									? formatSubjectOption(subject.name, subject.employeeNo)
									: "読み込み中...";
							})()}
						</option>
					</Show>
				</select>
			</div>
		);
	};

	const ProfileCards = () => (
		<section class="sheet-info-card">
			<div class="info-grid">
				<div class="info-item">
					<User class="info-icon" />
					<div class="info-content">
						<span class="info-label">評価対象者</span>
						<span class="info-value">{sheet()?.subject?.name ?? "—"}</span>
						<span class="info-meta">
							{sheet()?.subject?.employeeNo ?? "—"} / {sheet()?.subject?.gradeName ?? "—"}
						</span>
					</div>
				</div>
				<div class="info-item">
					<CalendarDays class="info-icon" />
					<div class="info-content">
						<span class="info-label">評価期間</span>
						<span class="info-value">{sheet()?.evaluationPeriod?.periodName ?? "—"}</span>
						<span class="info-meta">
							{sheet()?.evaluationPeriod?.startDate ?? "—"} 〜{" "}
							{sheet()?.evaluationPeriod?.endDate ?? "—"}
						</span>
					</div>
				</div>
				<div class="info-item">
					<Users class="info-icon" />
					<div class="info-content">
						<span class="info-label">評価者</span>
						<div class="evaluator-list">
							<span class="evaluator-item">
								<span class="evaluator-badge">1次</span>
								{sheet()?.primaryEvaluator ?? "—"}
							</span>
							<span class="evaluator-item">
								<span class="evaluator-badge">2次</span>
								{sheet()?.secondaryEvaluator ?? "—"}
							</span>
						</div>
					</div>
				</div>
			</div>
		</section>
	);

	const FinalEvaluationRankSection = () => (
		<Show when={canEditSecond()}>
			<section class="final-rank-panel">
				<div class="final-rank-panel__title">
					<Award class="section-icon" />
					<div>
						<h2>最終評価ランク</h2>
						<p>二次評価者決定</p>
					</div>
				</div>
				<label class="final-rank-selector" for="final-rank-select">
					<select
						id="final-rank-select"
						value={selectedFinalRankValue()}
						disabled={viewModel().updatingFinalEvaluationRank}
						onChange={(event) => {
							const [letter, level] = event.currentTarget.value.split("|");
							if (letter && level) {
								void props.controller.decideFinalEvaluationRank(letter, level);
							}
						}}
					>
						<option value="" disabled>
							未決定
						</option>
						<For each={finalRankOptions()}>
							{(option) => <option value={option.value}>{option.label}</option>}
						</For>
					</select>
				</label>
				<Show when={viewModel().finalEvaluationRankUpdateError}>
					<p class="error-message">{viewModel().finalEvaluationRankUpdateError}</p>
				</Show>
			</section>
		</Show>
	);

	const renderSheetContent = () => {
		const currentSheet = sheet();
		if (currentSheet?.subject == null) {
			return <p>データを取得できませんでした。</p>;
		}

		return (
			<>
				<ProfileCards />
				<FinalEvaluationRankSection />
				<ChallengeEvaluationView
					sheetId={sheetId() ?? null}
					objectives={currentSheet.objectives ?? []}
					subject={currentSheet.subject}
					canEditFirst={canEditFirst()}
					canEditSecond={canEditSecond()}
					canEditMilestoneGoal={viewModel().canEditMilestoneGoal}
					canViewSecondEvaluation={viewModel().canViewSecondEvaluation}
					isEditable={currentSheet.isEditable}
					controller={props.challengeEvaluationController}
					viewModel={props.challengeEvaluationViewModel}
					onUpdated={reloadCurrentSheetFromRoute}
				/>
				<Show when={viewModel().canViewCommonEvaluation}>
					<CommonEvaluationView
						sheetId={sheetId() ?? null}
						gradeId={currentSheet.subject.gradeId}
						canEditFirst={canEditFirst()}
						canEditSecond={canEditSecond()}
						canViewSecondEvaluation={viewModel().canViewSecondEvaluation}
						controller={props.commonEvaluationController}
						viewModel={props.commonEvaluationViewModel}
						onUpdated={reloadCurrentSheetFromRoute}
					/>
				</Show>
				<OverallCommentSection
					canEditFirst={canEditFirst()}
					canEditSecond={canEditSecond()}
					firstOverallComment={firstOverallDraft()}
					secondOverallComment={secondOverallDraft()}
					onFirstOverallCommentChange={setFirstOverallDraft}
					onSecondOverallCommentChange={setSecondOverallDraft}
					onSaveFirstOverallComment={() =>
						void props.controller.updateOverallComment("first", firstOverallDraft())
					}
					onSaveSecondOverallComment={() =>
						void props.controller.updateOverallComment("second", secondOverallDraft())
					}
					updating={viewModel().updatingOverallComment}
					updateError={viewModel().overallCommentUpdateError}
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
					<Show when={!isNew() && sheet()}>
						<EditorManagementHeader />
						<EvaluationStatusToggle
							status={sheet()?.status ?? "draft"}
							isOwner={viewModel().isSubject}
							canFinalize={viewModel().canFinalizeAsSecondaryEvaluator}
							updating={viewModel().updatingStatus}
							updateError={viewModel().statusUpdateError}
							onStatusChange={handleStatusChange}
							onFinalize={handleFinalize}
						/>
					</Show>
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
