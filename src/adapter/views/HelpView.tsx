import { A } from "@solidjs/router";
import ArrowRight from "lucide-solid/icons/arrow-right";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ClipboardCheck from "lucide-solid/icons/clipboard-check";
import PencilLine from "lucide-solid/icons/pencil-line";
import { type Component, createSignal, For, Show } from "solid-js";
import "./styles/help.css";

const GUIDES = {
	self: [
		{
			title: "評価シートを開く",
			description:
				"「評価シート一覧」から、今回の評価期間のシートを開きます。シートがない場合は「新規作成」で評価期間を選んで作成します。",
			labels: ["評価シート一覧", "新規作成"],
			tip: "評価期間が今回のものになっているか確認してください。",
		},
		{
			title: "目標と達成状況を記入する",
			description:
				"「目標を編集」から入力します。期初はチャレンジ目標と中間目標を、期末は達成状況を記入します。",
			labels: ["目標を編集", "目標を保存"],
			tip: "目標ごとに「目標を保存」を押します。保存した内容は、あとから続けて編集できます。",
		},
		{
			title: "提出する",
			description:
				"記入した内容を保存したあと、シート上部の「提出する」を押します。状態が「提出済み」になると、評価者が評価を始められます。",
			labels: ["提出する", "提出済み"],
			tip: "保存だけでは提出されません。提出するまでは、評価者に内容は表示されません。",
		},
	],
	reviewer: [
		{
			title: "評価するシートを開く",
			description:
				"「部下の評価」を開き、「一次評価する」または「二次評価する」の件数を押すと、評価する社員が表示されます。",
			labels: ["部下の評価", "一次評価する", "二次評価する"],
			tip: "「提出・相手の評価待ち」は、本人の提出または一次評価の確定を待っている状態です。",
		},
		{
			title: "点数と総評を入力する",
			description:
				"チャレンジ目標と共通評価を、それぞれ1〜4の4段階で評価します。二次評価者には一次評価の内容も表示されます。",
			labels: ["評価を入力", "評価を保存", "総評を保存"],
			tip: "点数はすべての項目に入力し、欄ごとに保存します。総評は「総評を保存」で保存されます。",
		},
		{
			title: "確定する",
			description:
				"シート下部のボタンで確定します。一次評価を確定すると二次評価者に引き継がれ、二次評価を確定すると評価が完了します。",
			labels: ["一次評価を確定する", "二次評価を確定する"],
			tip: "確定した評価は変更できません。二次評価者が「なし」の場合は「評価を確定する」で完了します。",
		},
	],
};
const QUESTIONS = {
	self: [
		[
			"提出後に内容を修正したい",
			"一次評価が確定する前であれば、シートの「下書きに戻す」から修正できます。修正後に保存し、再度「提出する」を押してください。一次評価の確定後は変更できないため、評価者に相談してください。",
		],
		[
			"記入を途中で中断したい",
			"目標ごとに「目標を保存」を押してから画面を閉じてください。同じ評価期間のシートを開くと、保存した内容から再開できます。",
		],
		[
			"自分の評価結果を確認したい",
			"自分のシートでは、目標ごとの一次評価の点数を確認できます。共通評価・総評・合計点・評価ランクは表示されません。",
		],
	],
	reviewer: [
		[
			"シートを開けない、または評価を入力できない",
			"本人が提出していないシートは開けません。二次評価は、一次評価が確定すると入力できます。「部下の評価」で進み具合を確認してください。",
		],
		[
			"確定ボタンを押せない",
			"チャレンジ目標と共通評価に、点数が入っていない項目がないか確認してください。0は未評価です。点数と総評を保存してから確定します。不足している項目は画面に表示されます。",
		],
		[
			"評価点と評価ランクの計算方法",
			"チャレンジ目標と共通評価の点数から、100点満点の評価点と評価ランクが自動で計算されます。確定前に表示されるランクは見込みです。",
		],
		[
			"評価が確定したシートをPDFで出力したい",
			"「評価シート一覧」の「部下の評価シート」で、評価確定のシートの「PDF出力」を押します。最終評価者以外が出力した場合、二次評価と最終評価の内容は伏せ字になります。",
		],
	],
};
const HelpView: Component = () => {
	const [audience, setAudience] = createSignal<"self" | "reviewer">("self");
	const isSelf = () => audience() === "self";
	return (
		<div class="help-guide">
			<header class="help-guide__hero">
				<h1>ヘルプ</h1>
				<p>評価シートの記入方法と、評価方法を説明します。</p>
			</header>
			<fieldset class="help-guide__choices">
				<legend class="visually-hidden">説明の対象</legend>
				<button
					type="button"
					aria-pressed={isSelf()}
					aria-controls="help-guide-content"
					onClick={() => setAudience("self")}
				>
					<PencilLine size={24} aria-hidden="true" />
					<span>
						<strong>記入方法</strong>
						<small>被評価者向け</small>
					</span>
					<span class="help-guide__selection" aria-hidden="true">
						<Show when={isSelf()}>
							<Check size={16} />
						</Show>
					</span>
				</button>
				<button
					type="button"
					aria-pressed={!isSelf()}
					aria-controls="help-guide-content"
					onClick={() => setAudience("reviewer")}
				>
					<ClipboardCheck size={24} aria-hidden="true" />
					<span>
						<strong>評価方法</strong>
						<small>一次評価者・二次評価者向け</small>
					</span>
					<span class="help-guide__selection" aria-hidden="true">
						<Show when={!isSelf()}>
							<Check size={16} />
						</Show>
					</span>
				</button>
			</fieldset>
			<section id="help-guide-content" aria-labelledby="help-guide-title">
				<div class="help-guide__heading">
					<h2 id="help-guide-title">{isSelf() ? "記入方法について" : "評価方法について"}</h2>
					<A href={isSelf() ? "/" : "/review"} class="help-guide__start">
						{isSelf() ? "評価シート一覧へ" : "部下の評価へ"}
						<ArrowRight size={18} aria-hidden="true" />
					</A>
				</div>
				<ol class="help-guide__steps">
					<For each={GUIDES[audience()]}>
						{(step, index) => (
							<li>
								<span class="help-guide__number" aria-hidden="true">
									0{index() + 1}
								</span>
								<h3>{step.title}</h3>
								<p>{step.description}</p>
								<div class="help-guide__labels">
									<For each={step.labels}>{(label) => <span>{label}</span>}</For>
								</div>
								<p class="help-guide__tip">{step.tip}</p>
							</li>
						)}
					</For>
				</ol>
				<Show when={isSelf()}>
					<aside class="help-guide__example">
						<h3>記入例</h3>
						<dl class="help-guide__sample">
							<div>
								<dt>
									チャレンジ目標<span>期間内に目指すこと</span>
								</dt>
								<dd>9月末までに問い合わせ対応の手順をまとめ、対応時間を短縮する。</dd>
							</div>
							<div>
								<dt>
									中間目標<span>期間の途中での目安</span>
								</dt>
								<dd>6月末までによくある問い合わせを整理し、手順書の案を作成する。</dd>
							</div>
							<div>
								<dt>
									達成状況<span>期末の結果</span>
								</dt>
								<dd>手順書を作成してチームに共有した。平均対応時間が15分から10分になった。</dd>
							</div>
						</dl>
					</aside>
				</Show>
			</section>
			<section class="help-guide__faq" aria-labelledby="help-faq-title">
				<h2 id="help-faq-title">よくある質問</h2>
				<For each={QUESTIONS[audience()]}>
					{([question, answer]) => (
						<details>
							<summary>
								{question}
								<ChevronDown size={18} aria-hidden="true" />
							</summary>
							<p>{answer}</p>
						</details>
					)}
				</For>
				<details>
					<summary>
						パスワードを忘れた
						<ChevronDown size={18} aria-hidden="true" />
					</summary>
					<p>
						TYPA
						の管理担当者に登録の取り消しを依頼してから、新規登録をやり直してください。評価シートのデータは残ります。
					</p>
				</details>
			</section>
		</div>
	);
};
export default HelpView;
