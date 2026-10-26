import { A } from "@solidjs/router";
import ArrowLeft from "lucide-solid/icons/arrow-left";
import FileDown from "lucide-solid/icons/file-down";
import FileUp from "lucide-solid/icons/file-up";
import { type Component, createResource, createSignal, For, Show } from "solid-js";
import { messageOf } from "../../application/errorMessage";
import type {
	SheetImportFile,
	SheetImportResult,
} from "../../domain/repositories/SheetImportRepository";
import type { SheetImportController } from "../controllers/SheetImportController";
import { confirmAction, showToast } from "./feedback";

const FILE_LABEL: Record<SheetImportFile, string> = { goals: "目標", common: "共通評価" };

/** 導入処理の「データ取込」。テンプレートを配り、記入された CSV を確かめてから実施中の評価期間のシートに入れる。 */
const SheetImportView: Component<{ controller: SheetImportController }> = (props) => {
	const [template] = createResource(() => props.controller.loadTemplate());
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

	const run = async (apply: boolean) => {
		setBusy(true);
		try {
			const outcome = await props.controller.run(files().goals, files().common, apply);
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
		if (!summary) {
			return;
		}
		const confirmed = await confirmAction({
			title: `「${summary.periodName}」の評価シートに取り込みます`,
			message: `${summary.employees}人分の目標・共通評価を取り込みます。`,
			details: [
				`新しく作るシート ${summary.newSheets}枚`,
				`内容を置き換えるシート ${summary.replacedSheets}枚`,
			],
			note: "置き換えるシートの目標・共通評価は、ファイルの内容だけになります。元には戻せません。",
			confirmLabel: "取り込む",
			tone: summary.replacedSheets > 0 ? "danger" : "default",
		});
		if (confirmed) {
			await run(true);
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
						実施中の評価期間の目標・共通評価と点数を、CSV
						でまとめて取り込みます。誤りが1件でもあれば、何も取り込みません。
					</p>
				</div>
			</header>

			<Show when={!template.loading} fallback={<p class="page-note">読み込んでいます...</p>}>
				<Show
					when={!template.error && template()}
					fallback={<p class="page-note">{messageOf(template.error, "読み込めませんでした。")}</p>}
				>
					{(loaded) => (
						<>
							<section class="info-card" aria-labelledby="import-template-heading">
								<h2 id="import-template-heading">1. テンプレートを保存して記入する</h2>
								<p>
									実施中の評価期間「{loaded().periodName}」・対象 {loaded().employees.length}
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
										何も書いていない行は取り込みません。1行でも書いた社員は、この評価期間の目標(または共通評価)がファイルの内容に置き換わります。
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
		</div>
	);
};

export default SheetImportView;
