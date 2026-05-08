import { CalendarDays, FileText, LogOut } from "lucide-solid";
import { type Component, createEffect, createResource, createSignal, For, Show } from "solid-js";
import { supabase } from "../../utils/supabase";
import ChallengeEvaluation from "./ChallengeEvaluation";
import CommonEvaluation from "./CommonEvaluation";
import { fetchDistinctEvaluationPeriods } from "./helpers/evaluationPeriods";
import { fetchEvaluationSheet } from "./helpers/evaluationSheet";
import ProfileCards from "./ProfileCards";
import "../styles/dashboard.css";

const Dashboard: Component = () => {
	const [periodOptions] = createResource(fetchDistinctEvaluationPeriods);
	const [selectedPeriodId, setSelectedPeriodId] = createSignal<number | null>(null);
	const [sheet, { refetch }] = createResource(selectedPeriodId, fetchEvaluationSheet);

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
					評価シート
				</h1>
				<button type="button" class="logout-button" onClick={handleLogout}>
					<LogOut class="button-icon" />
					ログアウト
				</button>
			</header>

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

			<Show when={!sheet.loading} fallback={<p>シート情報を読み込み中です...</p>}>
				<Show when={sheet()?.subject} keyed fallback={<p>データを取得できませんでした。</p>}>
					{(subject) => (
						<>
							<ProfileCards
								subject={subject}
								evaluationPeriodName={sheet()?.evaluationPeriod?.period_name}
								primaryEvaluator={sheet()?.primaryEvaluator ?? "未設定"}
								secondaryEvaluator={sheet()?.secondaryEvaluator ?? "未設定"}
							/>

							<ChallengeEvaluation
								objectives={sheet()?.objectives ?? []}
								subject={subject}
								onUpdated={() => refetch()}
							/>

							<Show when={sheet()?.sheetId} keyed>
								{(sheetId) => (
									<CommonEvaluation
										sheetId={sheetId}
										periodId={selectedPeriodId() ?? 0}
										employeeId={subject.id}
										onCreated={() => refetch()}
									/>
								)}
							</Show>
							<Show when={sheet()?.sheetId == null}>
								<CommonEvaluation
									sheetId={null}
									periodId={selectedPeriodId() ?? 0}
									employeeId={subject.id}
									onCreated={() => refetch()}
								/>
							</Show>
						</>
					)}
				</Show>
			</Show>
		</div>
	);
};

export default Dashboard;
