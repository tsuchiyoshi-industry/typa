import { useNavigate, useParams } from "@solidjs/router";
import { CalendarDays, FileText, LogOut } from "lucide-solid";
import { type Component, createEffect, createResource, createSignal, For, Show } from "solid-js";
import { supabase } from "../../utils/supabase";
import ChallengeEvaluation from "./ChallengeEvaluation";
import CommonEvaluation from "./CommonEvaluation";
import { fetchDistinctEvaluationPeriods } from "./helpers/evaluationPeriods";
import { fetchEvaluationSheetById } from "./helpers/evaluationSheet";
import ProfileCards from "./ProfileCards";
import "../styles/dashboard.css";

const SheetEditor: Component = () => {
	const params = useParams();
	const navigate = useNavigate();
	const sheetId = () => params.id;
	const isNew = () => sheetId() === "new";

	const [periodOptions] = createResource(fetchDistinctEvaluationPeriods);
	const [selectedPeriodId, setSelectedPeriodId] = createSignal<number | null>(null);
	const [sheet, { refetch }] = createResource(
		() => (isNew() ? null : parseInt(sheetId(), 10)),
		(id) => (id ? fetchEvaluationSheetById(id) : null),
	);

	const [creating, setCreating] = createSignal(false);
	const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

	const createSheet = async () => {
		if (!selectedPeriodId()) {
			return;
		}
		setCreating(true);
		setErrorMessage(null);
		try {
			// ログインユーザーの employee_id を取得
			const {
				data: { user },
			} = await supabase.auth.getUser();
			if (!user) {
				throw new Error("ログインが必要です");
			}

			const { data: employee, error } = await supabase
				.from("employees")
				.select("id")
				.eq("user_id", user.id)
				.single();

			if (error) {
				throw error;
			}

			// 重複チェック: 同じ期間のシートが既に存在するか確認
			const { data: existingSheet, error: checkError } = await supabase
				.from("evaluation_sheets")
				.select("id")
				.eq("period_id", selectedPeriodId())
				.eq("employee_id", employee.id)
				.maybeSingle();

			if (checkError) {
				throw checkError;
			}

			if (existingSheet) {
				throw new Error("この期間の評価シートは既に作成されています。");
			}

			// evaluation_sheets を insert
			const { data: sheetData, error: sheetError } = await supabase
				.from("evaluation_sheets")
				.insert({ period_id: selectedPeriodId(), employee_id: employee.id })
				.select("id")
				.single();

			if (sheetError) {
				throw sheetError;
			}

			// 作成された sheetId で遷移
			navigate(`/sheet/${sheetData.id}`);
		} catch (error) {
			console.error("Sheet creation failed:", error);
			setErrorMessage(error instanceof Error ? error.message : "シート作成に失敗しました。");
		} finally {
			setCreating(false);
		}
	};

	createEffect(() => {
		const periods = periodOptions();
		if (periods && periods.length > 0 && selectedPeriodId() === null) {
			setSelectedPeriodId(periods[0].id);
		}
	});

	const handleLogout = async () => {
		await supabase.auth.signOut();
	};

	return (
		<div class="dashboard-page">
			<header class="dashboard-header">
				<h1>
					<FileText class="header-icon" />
					{isNew() ? "新規評価シート" : "評価シート"}
				</h1>
				<button type="button" class="logout-button" onClick={handleLogout}>
					<LogOut class="button-icon" />
					ログアウト
				</button>
			</header>

			<Show when={!sheet.loading} fallback={<p>シート情報を読み込み中です...</p>}>
				<Show when={isNew()}>
					<div class="new-sheet-setup">
						<h2>新規評価シートの作成</h2>
						<Show when={errorMessage()}>
							<p class="error-message">{errorMessage()}</p>
						</Show>
						<div class="period-picker">
							<label for="period-select">
								<CalendarDays class="select-icon" />
								評価対象期間
							</label>
							<select
								id="period-select"
								value={selectedPeriodId() ?? ""}
								onChange={(e) => setSelectedPeriodId(parseInt(e.currentTarget.value, 10))}
							>
								<option value="" disabled>
									期間を選択してください
								</option>
								<For each={periodOptions() ?? []}>
									{(period) => <option value={period.id}>{period.period_name}</option>}
								</For>
							</select>
						</div>
						<button
							type="button"
							class="create-sheet-button"
							onClick={createSheet}
							disabled={creating() || !selectedPeriodId()}
						>
							{creating() ? "作成中..." : "評価シートを作成"}
						</button>
					</div>
				</Show>
				<Show
					when={!isNew() && sheet()?.subject}
					keyed
					fallback={<p>データを取得できませんでした。</p>}
				>
					{(subject) => (
						<>
							<ProfileCards
								subject={subject}
								evaluationPeriodName={sheet()?.evaluationPeriod?.period_name ?? "未設定"}
								primaryEvaluator={sheet()?.primaryEvaluator ?? "未設定"}
								secondaryEvaluator={sheet()?.secondaryEvaluator ?? "未設定"}
							/>

							<ChallengeEvaluation
								objectives={sheet()?.objectives ?? []}
								subject={subject}
								onUpdated={() => refetch()}
							/>

							<CommonEvaluation
								sheetId={sheet()?.sheetId ?? null}
								periodId={sheet()?.evaluationPeriod?.id ?? 0}
								employeeId={subject.id}
								subject={subject}
								onCreated={() => refetch()}
							/>
						</>
					)}
				</Show>
			</Show>
		</div>
	);
};

export default SheetEditor;
