import { A } from "@solidjs/router";
import ArrowLeft from "lucide-solid/icons/arrow-left";
import FileDown from "lucide-solid/icons/file-down";
import FileUp from "lucide-solid/icons/file-up";
import { type Component, createResource, createSignal, For, Show } from "solid-js";
import type { SheetImportPeriodDto } from "../../application/dtos/SheetImportPeriodDto";
import { messageOf } from "../../application/errorMessage";
import type {
	SheetImportFile,
	SheetImportResult,
} from "../../domain/repositories/SheetImportRepository";
import type { SheetImportController } from "../controllers/SheetImportController";
import { confirmAction, showToast } from "./feedback";

const FILE_LABEL: Record<SheetImportFile, string> = { goals: "目標", common: "共通評価" };

/**
 * 導入処理の「データ取込」。評価期間(実施中か締め済み)を選び、テンプレートを配り、記入された CSV を確かめてから
 * その評価期間のシートに入れる。締め済みの評価期間は、締めを越えて書くので、注意を出してから確かめる。
 */
const SheetImportView: Component<{ controller: SheetImportController }> = (props) => {
	const [periods] = createResource(() => props.controller.periods());
	const [periodId, setPeriodId] = createSignal<number | null>(null);
	// 読み込みに失敗したリソースの値を読むと例外になるので、失敗したら空として扱う(理由は別に出す)
	const periodList = (): SheetImportPeriodDto[] => (periods.error ? [] : (periods() ?? []));
	// 選ぶまでは、実施中の評価期間(無ければいちばん新しい締め済み)
	const period = () =>
		periodList().find((entry) => entry.id === periodId()) ??
		periodList().find((entry) => !entry.needsConfirmation) ??
		periodList()[0];
	const [template] = createResource(
		() => period()?.id,
		(id) => props.controller.loadTemplate(id),
	);
	const [files, setFiles] = createSignal<Record<SheetImportFile, File | null>>({
		goals: null,
		common: null,
	});
	const [result, setResult] = createSignal<SheetImportResult | null>(null);
	const [busy, setBusy] = createSignal(false);

	const saveTemplate = async (file: SheetImportFile) => {
		const loaded = template();
		if (!loaded) {
			return;
		}
		try {
			const path = await props.controller.saveTemplate(file, loaded);
			if (path) {
				showToast("success", `${FILE_LABEL[file]}のテンプレートを保存しました。`, path);
			}
		} catch (error) {
			showToast("error", "テンプレートを保存できませんでした。", messageOf(error, ""));
		}
	};

	const pick = (file: SheetImportFile, event: Event & { currentTarget: HTMLInputElement }) => {
		setFiles({ ...files(), [file]: event.currentTarget.files?.[0] ?? null });
		// 選び直したら、前の確認結果は使わない
		setResult(null);
	};

	const choosePeriod = (id: number) => {
		setPeriodId(id);
		// 評価期間を変えたら、前の確認結果は使わない(選んだファイルはそのまま確かめ直せる)
		setResult(null);
	};

	/** closedPeriodConfirmed: 締め済みの評価期間に書くと、確認のダイアログで確かめたか。 */
	const run = async (apply: boolean, closedPeriodConfirmed = false) => {
		const target = period();
		if (!target) {
			return;
		}
		setBusy(true);
		try {
			const outcome = await props.controller.run({
				periodId: target.id,
				closedPeriodConfirmed,
				goals: files().goals,
				common: files().common,
				apply,
			});
			setResult(outcome);
			if (outcome.applied) {
				showToast("success", "取り込みました。", "メールは送っていません。");
			}
		} finally {
			setBusy(false);
		}
	};

	const apply = async () => {
		const summary = result()?.summary;
		const target = period();
		if (!summary || !target) {
			return;
		}
		const closed = target.needsConfirmation;
		const confirmed = await confirmAction({
			title: closed
				? `締め済みの「${summary.periodName}」に取り込みます`
				: `「${summary.periodName}」の評価シートに取り込みます`,
			message: `${summary.employees}人分の目標・共通評価を取り込みます。`,
			details: [
				`新しく作るシート ${summary.newSheets}枚`,
				`内容を置き換えるシート ${summary.replacedSheets}枚`,
			],
			note: closed
				? "締めた評価期間のシートを、締めを越えて作る・置き換えます。本人と評価者はふだんの操作では直せません。取り込んだこと、置き換えた元の内容は監査ログに残ります。元には戻せません。"
				: "置き換えるシートの目標・共通評価は、ファイルの内容だけになります。元には戻せません。",
			confirmLabel: "取り込む",
			tone: closed || summary.replacedSheets > 0 ? "danger" : "default",
		});
		if (confirmed) {
			await run(true, closed);
		}
	};

	const errors = () => result()?.errors ?? [];
	const nothingPicked = () => !files().goals && !files().common;

	return (
		<div class="settings-page">
			<header class="master-header">
				<div>
					<A href="/setup" class="back-link">
						<ArrowLeft size={16} aria-hidden="true" />
						導入処理
					</A>
					<h1>
						<FileUp class="header-icon" />
						データ取込
					</h1>
					<p>
						選んだ評価期間(実施中か締め済み)の目標・共通評価と点数を、CSV
						でまとめて取り込みます。誤りが1件でもあれば、何も取り込みません。
					</p>
				</div>
			</header>

			<Show when={!periods.loading} fallback={<p class="page-note">読み込んでいます...</p>}>
				<Show
					when={!periods.error}
					fallback={<p class="page-note">{messageOf(periods.error, "読み込めませんでした。")}</p>}
				>
					<Show
						when={period()}
						fallback={
							<p class="page-note">
								取り込める評価期間がありません。先に「設定」で評価期間を開始してください。
							</p>
						}
					>
						{(target) => (
							<section class="info-card" aria-labelledby="import-period-heading">
								<h2 id="import-period-heading">取り込む評価期間</h2>
								<label class="import-file">
									<span>評価期間</span>
									<select
										value={target().id}
										disabled={busy()}
										onChange={(event) => choosePeriod(Number(event.currentTarget.value))}
									>
										<For each={periodList()}>
											{(entry) => (
												<option value={entry.id}>
													{entry.periodName}({entry.stateLabel})
												</option>
											)}
										</For>
									</select>
								</label>
								<Show when={target().needsConfirmation}>
									<p class="import-caution">
										締め済みの評価期間です。取り込むと、締めた後のシートを作る・置き換えます。本人と評価者はふだんの操作では直せません。取り込んだこと、置き換えた元の内容は監査ログに残ります。
									</p>
								</Show>
							</section>
						)}
					</Show>
				</Show>
			</Show>

			<Show when={period()}>
				<Show when={!template.loading} fallback={<p class="page-note">読み込んでいます...</p>}>
					<Show
						when={!template.error && template()}
						fallback={
							<p class="page-note">{messageOf(template.error, "読み込めませんでした。")}</p>
						}
					>
						{(loaded) => (
							<>
								<section class="info-card" aria-labelledby="import-template-heading">
									<h2 id="import-template-heading">1. テンプレートを保存して記入する</h2>
									<p>
										評価期間「{loaded().periodName}」・対象 {loaded().employees.length}
										人・目標は1人 {loaded().maxGoals}件まで。目標を送信済みの社員は載りません。
									</p>
									<p class="field-hint">
										期中目標が2件以上あるときは、同じ社員番号・目標番号の行を足して、1行に1件ずつ書きます。チャレンジ目標と点数は最初の行だけに書きます。
									</p>
									<div class="import-actions">
										<button
											type="button"
											class="secondary-action"
											onClick={() => void saveTemplate("goals")}
										>
											<FileDown size={18} aria-hidden="true" />
											目標のテンプレート
										</button>
										<button
											type="button"
											class="secondary-action"
											onClick={() => void saveTemplate("common")}
										>
											<FileDown size={18} aria-hidden="true" />
											共通評価のテンプレート
										</button>
									</div>
									<ul>
										<li>
											記入するのは本文と点数だけです。社員番号・目標番号・項目IDは変えないでください。氏名と項目名は、取り違えていないかの確認に使います。
										</li>
										<li>点数は 1〜4 の数字か、空欄にします。</li>
										<li>
											何も書いていない行は取り込みません。1行でも書いた社員は、選んだ評価期間の目標(または共通評価)がファイルの内容に置き換わります。
										</li>
										<li>Excel では「CSV UTF-8」「CSV」のどちらで保存しても読めます。</li>
									</ul>
								</section>

								<section class="info-card" aria-labelledby="import-files-heading">
									<h2 id="import-files-heading">2. ファイルを選んで確認する</h2>
									<p>片方だけでも取り込めます。確認の段階では、まだ何も書き込みません。</p>
									<div class="import-files">
										<For each={["goals", "common"] as const}>
											{(file) => (
												<label class="import-file">
													<span>{FILE_LABEL[file]}</span>
													<input
														type="file"
														accept=".csv,text/csv"
														disabled={busy()}
														onChange={(event) => pick(file, event)}
													/>
												</label>
											)}
										</For>
									</div>
									<div class="import-actions">
										<button
											type="button"
											class="primary-action"
											disabled={busy() || nothingPicked()}
											onClick={() => void run(false)}
										>
											内容を確認
										</button>
									</div>
								</section>

								<Show when={errors().length > 0}>
									<section
										class="info-card import-errors"
										role="alert"
										aria-labelledby="import-errors-heading"
									>
										<h2 id="import-errors-heading">
											取り込めません。誤りが {errors().length}件あります
										</h2>
										<p>
											誤りが1件でもあると、何も取り込みません。ファイルを直して選び直し、もう一度確認してください。行は
											Excel の行番号です(見出しが1行目)。
										</p>
										<div class="import-errors-scroll">
											<table>
												<thead>
													<tr>
														<th scope="col">ファイル</th>
														<th scope="col">行</th>
														<th scope="col">内容</th>
													</tr>
												</thead>
												<tbody>
													<For each={errors()}>
														{(error) => (
															<tr>
																<td>{error.file ? FILE_LABEL[error.file] : "—"}</td>
																<td>{error.line ?? "—"}</td>
																<td>{error.message}</td>
															</tr>
														)}
													</For>
												</tbody>
											</table>
										</div>
									</section>
								</Show>

								<Show when={errors().length === 0 && result()?.summary}>
									{(summary) => (
										<section class="info-card" aria-labelledby="import-apply-heading">
											<h2 id="import-apply-heading">
												{result()?.applied ? "取り込みました" : "3. 取り込む"}
											</h2>
											<dl class="import-summary">
												<div>
													<dt>対象の社員</dt>
													<dd>{summary().employees}人</dd>
												</div>
												<div>
													<dt>新しく作るシート</dt>
													<dd>{summary().newSheets}枚</dd>
												</div>
												<div>
													<dt>置き換えるシート</dt>
													<dd>{summary().replacedSheets}枚</dd>
												</div>
												<div>
													<dt>目標</dt>
													<dd>{summary().goals}件</dd>
												</div>
												<div>
													<dt>共通評価</dt>
													<dd>{summary().commonResults}件</dd>
												</div>
											</dl>
											<p>シートは下書きのまま作ります。メールは1通も送りません。</p>
											<Show when={!result()?.applied}>
												<div class="import-actions">
													<button
														type="button"
														class="primary-action"
														disabled={busy()}
														onClick={() => void apply()}
													>
														取り込む
													</button>
												</div>
											</Show>
										</section>
									)}
								</Show>
							</>
						)}
					</Show>
				</Show>
			</Show>
		</div>
	);
};

export default SheetImportView;
