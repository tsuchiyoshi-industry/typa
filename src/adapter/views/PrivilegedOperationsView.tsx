import ShieldAlert from "lucide-solid/icons/shield-alert";
import { type Component, createMemo, createResource, createSignal, For, Show } from "solid-js";
import { messageOf } from "../../application/errorMessage";
import {
	EVALUATION_STATUS_VALUES,
	type EvaluationStatusValue,
} from "../../domain/valueObjects/EvaluationStatus";
import type { PrivilegedOperationsController } from "../controllers/PrivilegedOperationsController";
import { confirmAction, showToast } from "./feedback";
import { statusLabel } from "./format";

const PrivilegedOperationsView: Component<{ controller: PrivilegedOperationsController }> = (
	props,
) => {
	const [periods] = createResource(() => props.controller.periods());
	const periodList = () => (periods.error ? [] : (periods() ?? []));
	const [periodId, setPeriodId] = createSignal<number | null>(null);
	const selectedPeriod = () =>
		periodId() ?? periodList().find((period) => period.isActive)?.id ?? periodList()[0]?.id;
	const [sheets, { refetch }] = createResource(selectedPeriod, (id) => props.controller.sheets(id));
	const sheetList = () => (sheets.error || sheets.loading ? [] : (sheets() ?? []));
	const [sheetId, setSheetId] = createSignal<number | null>(null);
	const selectedSheet = createMemo(() => sheetList().find((sheet) => sheet.sheetId === sheetId()));
	const [action, setAction] = createSignal("changeStatus");
	const [status, setStatus] = createSignal<EvaluationStatusValue>("draft");
	const [reason, setReason] = createSignal("");
	const [busy, setBusy] = createSignal(false);
	const canSubmit = () =>
		selectedSheet() &&
		reason().trim().length > 0 &&
		reason().trim().length <= 500 &&
		(action() === "delete" || status() !== selectedSheet()?.status) &&
		!busy();

	const submit = async () => {
		const sheet = selectedSheet();
		if (!sheet || !canSubmit()) {
			return;
		}
		// 確認中も対象や操作を変更できない。表示した状態を RPC でも照合する。
		const request = {
			sheetId: sheet.sheetId,
			expectedStatus: sheet.status,
			action: action(),
			status: action() === "changeStatus" ? status() : undefined,
			reason: reason().trim(),
		};
		setBusy(true);
		try {
			if (
				!(await confirmAction({
					title:
						request.action === "delete"
							? "特権でシートを削除しますか？"
							: "特権でシートの状態を変更しますか？",
					message: `理由: ${request.reason}`,
					details: [
						`${sheet.employeeName}（${sheet.employeeNo}）・${periodList().find((period) => period.id === selectedPeriod())?.periodName}`,
						request.action === "delete"
							? "評価シートと、その目標・評価・修正履歴を削除"
							: `${statusLabel(sheet.status)} → ${statusLabel(status())}`,
					],
					note: "承認・通常の進行条件を省略して実行します。通知は送らず、操作者・対象・変更内容・理由を監査ログに残します。削除は取り消せません。",
					confirmLabel: request.action === "delete" ? "シートを削除する" : "状態を変更する",
					tone: "danger",
				}))
			) {
				return;
			}
			const result = await props.controller.execute(request);
			if (!result.success) {
				showToast("error", "特権操作を実行できませんでした", result.message);
				return;
			}
			showToast("success", result.message);
			setSheetId(null);
			setReason("");
			await refetch();
		} catch (error) {
			showToast(
				"error",
				"特権操作を完了できませんでした",
				messageOf(error, "時間をおいて再度お試しください。"),
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div class="settings-page">
			<header class="master-header">
				<div>
					<h1>
						<ShieldAlert class="header-icon" />
						特権操作
					</h1>
					<p>
						テスト・保守のため、承認や通常の進行条件を省略してシートを削除・状態変更します。締め済み期間も対象です。通知は送らず、操作の理由と内容を監査ログに記録します。
					</p>
				</div>
			</header>
			<Show when={!periods.loading} fallback={<p class="page-note">読み込んでいます...</p>}>
				<Show
					when={!periods.error}
					fallback={<p class="page-note">{messageOf(periods.error, "読み込めませんでした。")}</p>}
				>
					<section class="info-card privileged-operation-form">
						<h2>対象と操作を選ぶ</h2>
						<label class="correction-field">
							<span>評価期間</span>
							<select
								aria-label="評価期間"
								value={selectedPeriod() ?? ""}
								disabled={busy()}
								onChange={(event) => {
									setSheetId(null);
									setPeriodId(Number(event.currentTarget.value));
								}}
							>
								<For each={periodList()}>
									{(period) => (
										<option value={period.id}>
											{period.periodName}（{period.stateLabel}）
										</option>
									)}
								</For>
							</select>
						</label>
						<Show when={sheets.error}>
							<p class="page-note">{messageOf(sheets.error, "シートを読み込めませんでした。")}</p>
						</Show>
						<label class="correction-field">
							<span>対象シート</span>
							<select
								aria-label="対象シート"
								value={sheetId() ?? ""}
								disabled={busy() || sheets.loading}
								onChange={(event) => setSheetId(Number(event.currentTarget.value) || null)}
							>
								<option value="">シートを選択してください</option>
								<For each={sheetList()}>
									{(sheet) => (
										<option value={sheet.sheetId}>
											{sheet.employeeName}（{sheet.employeeNo}）・{statusLabel(sheet.status)}
										</option>
									)}
								</For>
							</select>
						</label>
						<label class="correction-field">
							<span>操作</span>
							<select
								aria-label="操作"
								value={action()}
								disabled={busy()}
								onChange={(event) => setAction(event.currentTarget.value)}
							>
								<option value="changeStatus">状態変更</option>
								<option value="delete">シート削除</option>
							</select>
						</label>
						<Show when={action() === "changeStatus"}>
							<label class="correction-field">
								<span>変更後の状態</span>
								<select
									aria-label="変更後の状態"
									value={status()}
									disabled={busy()}
									onChange={(event) =>
										setStatus(event.currentTarget.value as EvaluationStatusValue)
									}
								>
									<For each={EVALUATION_STATUS_VALUES}>
										{(value) => <option value={value}>{statusLabel(value)}</option>}
									</For>
								</select>
							</label>
						</Show>
						<label class="correction-field">
							<span>操作の理由</span>
							<textarea
								aria-label="操作の理由"
								rows={3}
								maxlength={500}
								value={reason()}
								disabled={busy()}
								onInput={(event) => setReason(event.currentTarget.value)}
							/>
						</label>
						<button
							type="button"
							class="primary-action danger"
							disabled={!canSubmit()}
							onClick={() => void submit()}
						>
							{busy() ? "処理中..." : "操作内容を確認"}
						</button>
					</section>
				</Show>
			</Show>
		</div>
	);
};
export default PrivilegedOperationsView;
