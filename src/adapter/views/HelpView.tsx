import { A } from "@solidjs/router";
import CircleQuestionMark from "lucide-solid/icons/circle-question-mark";
import { type Component, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { EvaluationAllocation } from "../../domain/valueObjects/EvaluationAllocation";
import type { SettingsController } from "../controllers/SettingsController";

interface HelpViewProps {
	controller: SettingsController;
}

const SECTIONS = [
	["flow", "評価の流れ"],
	["roles", "誰が何をできるか"],
	["score", "評価点の計算"],
	["rank", "評価ランク"],
	["review", "受け持ちの評価"],
	["pdf", "PDF 出力と通知メール"],
	["master", "社員マスタと権限"],
	["account", "ログインと登録"],
] as const;

const STAGES = [
	[
		"下書き",
		"本人",
		"チャレンジ目標・中間目標・達成状況を書いて「提出する」。提出するまで、評価者には内容が表示されません。",
	],
	[
		"提出済み",
		"一次評価者",
		"一次評価を入力して「一次評価を確定する」。確定すると一次評価は変更できなくなり、二次評価者に通知メールが届きます。確定までは、本人が下書きに戻して書き直せます。",
	],
	[
		"一次評価済み",
		"二次評価者",
		"一次評価を見ながら二次評価を入力して「二次評価を確定する」。一次評価が確定するまで、二次評価は入力できません。",
	],
	[
		"評価確定",
		"—",
		"評価シートはロックされ、本人も評価者も変更できません。評価者は PDF を出力できます。",
	],
] as const;

const RANKS = [
	["S", "95% 以上"],
	["A", "90% 以上"],
	["B+", "80% 以上"],
	["B", "60% 以上"],
	["B-", "50% 以上"],
	["C", "40% 以上"],
	["D", "40% 未満"],
] as const;

/** これまでの仕様と流れのまとめ。権限に関係なく誰でも読める。 */
const HelpView: Component<HelpViewProps> = (props) => {
	const [allocation, setAllocation] = createSignal<EvaluationAllocation | null>(null);
	const [error, setError] = createSignal(false);
	let mounted = true;
	onCleanup(() => {
		mounted = false;
	});
	const load = async () => {
		setError(false);
		try {
			const value = await props.controller.loadAllocation();
			if (mounted) {
				setAllocation(value);
			}
		} catch {
			if (mounted) {
				setError(true);
			}
		}
	};
	onMount(() => void load());
	const objective = () => allocation()?.objective ?? "—";
	const common = () => allocation()?.common ?? "—";
	const score = (points: number | undefined, rate: number) =>
		points == null ? "—" : EvaluationAllocation.toScore(points, rate);

	return (
		<div class="help-page">
			<header class="master-header">
				<div>
					<h1>
						<CircleQuestionMark class="header-icon" />
						ヘルプ
					</h1>
					<p>TYPA での人事考課の進め方と、評価点・評価ランクの決まり方をまとめています。</p>
				</div>
			</header>

			<nav class="help-toc" aria-label="目次">
				<For each={SECTIONS}>{([id, title]) => <a href={`#help-${id}`}>{title}</a>}</For>
			</nav>

			<section class="info-card" id="help-flow">
				<h2>評価の流れ</h2>
				<p>
					評価シートは、評価期間ごとに 1 人 1
					枚です。次の順に進み、いまが誰の番かはシート右上の進行表示で分かります。
				</p>
				<ol class="help-stages">
					<For each={STAGES}>
						{([stage, actor, description], index) => (
							<li>
								<span class="help-stage-number">{index() + 1}</span>
								<div>
									<strong>{stage}</strong>
									<span class="help-stage-actor">次に動く人: {actor}</span>
									<p>{description}</p>
								</div>
							</li>
						)}
					</For>
				</ol>
				<p>
					二次評価者が「なし」の社員は、一次評価者が最終評価者を兼ねます。「一次評価済み」は通らず、一次評価者の確定がそのまま評価確定になります。
				</p>
				<p>
					評価シートは「新規作成」で評価期間を選んで作ります。一覧の「作成時の等級」は、シートを作った時点の等級です。その後に等級が変わっても変わりません。
				</p>
			</section>

			<section class="info-card" id="help-roles">
				<h2>誰が何をできるか</h2>
				<p>評価シートでの立場は、社員マスタの「一次評価者」「二次評価者」の設定で決まります。</p>
				<div class="table-scroll">
					<table class="help-table">
						<thead>
							<tr>
								<th scope="col">立場</th>
								<th scope="col">入力できるもの</th>
								<th scope="col">見られるもの</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<th scope="row">本人</th>
								<td>チャレンジ目標・中間目標・達成状況（下書きの間だけ）</td>
								<td>
									自分の目標と、目標ごとの一次評価の点数。共通評価・総評・評価点の合計・評価ランクは表示されません。
								</td>
							</tr>
							<tr>
								<th scope="row">一次評価者</th>
								<td>目標と共通評価の一次評価、一次評価者の総評（提出済みの間だけ）</td>
								<td>
									提出された内容と一次評価、一次評価ランク。二次評価と最終評価の結果は表示されません。
								</td>
							</tr>
							<tr>
								<th scope="row">二次評価者</th>
								<td>目標と共通評価の二次評価、二次評価者の総評（一次評価済みの間だけ）</td>
								<td>提出された内容、一次評価、二次評価、最終評価の評価点と評価ランク。</td>
							</tr>
						</tbody>
					</table>
				</div>
				<p>
					二次評価者が「なし」の社員では、一次評価者が最終評価の評価点と評価ランクも見られます。
				</p>
			</section>

			<section class="info-card" id="help-score">
				<h2>評価点の計算</h2>
				<Show when={error()}>
					<div class="inline-alert" role="alert">
						<span>現在の配点を読み込めませんでした。計算方法は以下をご覧ください。</span>
						<button type="button" class="secondary-action" onClick={() => void load()}>
							再読み込み
						</button>
					</div>
				</Show>
				<Show when={!allocation() && !error()}>
					<p class="page-note">現在の配点を読み込んでいます...</p>
				</Show>
				<Show when={allocation()}>
					<p>
						評価点は {EvaluationAllocation.TOTAL} 点満点で、チャレンジ目標に{" "}
						<strong>{objective()} 点</strong>、共通評価に <strong>{common()} 点</strong>
						を割り振っています。この配点は Admin が「設定」で変更できます。
					</p>
				</Show>
				<dl class="allocation-rules">
					<div>
						<dt>チャレンジ目標（{objective()} 点）</dt>
						<dd>
							目標ごとに 1〜4 点で評価します。点数の合計 ÷（目標の数 × 4 点）×{" "}
							チャレンジ目標の配点が評価点です。目標が 2 つなら、2 つの点数を足して 8 で割ります。
							<small>
								例: どちらも 4 点 → {score(allocation()?.objective, 100)} 点 ／ 3 点と 4 点 →{" "}
								{score(allocation()?.objective, 87.5)} 点
							</small>
						</dd>
					</div>
					<div>
						<dt>共通評価（{common()} 点）</dt>
						<dd>
							等級ごとに決まった項目を、項目ごとに 1〜4
							点で評価します。項目の「配点」は評価に掛ける係数で、「配点 ×
							評価」がその項目の得点です。得点の合計 ÷ 満点（配点の合計 × 4）×
							共通評価の配点が評価点になります。配点 1 の項目が 10 個なら満点は 40
							点で、等級によって項目の数が違っても、評価点の満点は同じになります。
							<small>
								例: 得点率 75% → {score(allocation()?.common, 75)} 点 ／ 50% →{" "}
								{score(allocation()?.common, 50)} 点
							</small>
						</dd>
					</div>
				</dl>
				<p>
					得点率は途中で丸めず、配点を掛けた後にそれぞれ 1 点単位に四捨五入し、2
					つの評価点を足します。評価は 1〜4 の4段階で、0
					は未評価です。一次評価・二次評価を確定するときは、自分のチャレンジ目標と共通評価をすべて設定して保存する必要があります。未設定の項目が残っていると確定できません。
				</p>
				<p>
					配点を変更すると、まだ確定していない評価シートの評価点と見込みランクに反映されます。確定済みの評価シートは、確定したときの配点のままです。すでに確定した一次評価ランクも保持されます。
				</p>
			</section>

			<section class="info-card" id="help-rank">
				<h2>評価ランク</h2>
				<p>
					評価ランクは評価者が選ぶものではなく、評価点の得点率で自動的に決まります。確定する前は、いまの点数からの「見込み」として薄く表示されます。
				</p>
				<div class="table-scroll">
					<table class="help-table help-rank-table">
						<thead>
							<tr>
								<th scope="col">評価ランク</th>
								<th scope="col">評価点の得点率</th>
							</tr>
						</thead>
						<tbody>
							<For each={RANKS}>
								{([rank, range]) => (
									<tr>
										<th scope="row">{rank}</th>
										<td>{range}</td>
									</tr>
								)}
							</For>
						</tbody>
					</table>
				</div>
				<ul>
					<li>
						<strong>一次評価ランク</strong>
						は一次評価の評価点から決まり、一次評価を確定したときに保存されます。
					</li>
					<li>
						<strong>最終評価ランク</strong>
						は最終評価者の評価点から決まり、評価を確定したときに保存されます。最終評価者は二次評価者で、二次評価者が「なし」の社員では一次評価者です。
					</li>
				</ul>
			</section>

			<section class="info-card" id="help-review">
				<h2>受け持ちの評価</h2>
				<p>
					評価者は「
					<A href="/review">受け持ちの評価</A>
					」で、自分が一次・二次評価者になっている社員をまとめて見られます。
				</p>
				<ul>
					<li>
						上部の件数（一次評価する／二次評価する／提出・相手の評価待ち／評価確定）を押すと、その状態の社員だけに絞り込めます。
					</li>
					<li>
						行のどこを押しても評価シートが開きます。まだ提出されていない社員の行は開けません。
					</li>
					<li>
						氏名・社員番号の検索に加え、等級や一次評価者で絞り込めます。二次評価者は、一次評価者をラベルとして受け持ちを整理できます。
					</li>
					<li>
						評価を入力したら、シートの最後にあるバーから確定します。確定すると、次の「自分の番」のシートへ進みます。
					</li>
					<li>「横断比較」では、同じ等級の社員の評価点や根拠を並べて見比べられます。</li>
				</ul>
			</section>

			<section class="info-card" id="help-pdf">
				<h2>PDF 出力と通知メール</h2>
				<ul>
					<li>
						PDF
						を出力できるのは評価者だけで、評価が確定したシートに限ります。確定前は、評価シート一覧の「PDF出力」が押せません。
					</li>
					<li>
						最終評価者ではない一次評価者が出力した PDF
						では、二次評価と最終評価の内容が伏せられます。
					</li>
					<li>
						通知メールは、一次評価を確定したときに二次評価者へ、評価を確定したときに評価者へ送られます。宛先は、新規登録のときに入力したメールアドレスです。
					</li>
					<li>
						通知メールの送信に失敗しても、評価の確定は取り消されません。画面の案内に沿って宛先を確認してください。
					</li>
				</ul>
			</section>

			<section class="info-card" id="help-master">
				<h2>社員マスタと権限</h2>
				<p>
					「社員マスタ」では、自分の等級と評価者を確認できます。TYPA
					の権限によって、できることが変わります。自分の権限は画面右上に表示されます。
				</p>
				<div class="table-scroll">
					<table class="help-table">
						<thead>
							<tr>
								<th scope="col">権限</th>
								<th scope="col">できること</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<th scope="row">Employee</th>
								<td>自分の評価シートの作成と提出、自分の等級・評価者の確認。</td>
							</tr>
							<tr>
								<th scope="row">Reviewer</th>
								<td>上に加えて、全社員の評価者の変更と、社員マスタの「評価構造」での確認。</td>
							</tr>
							<tr>
								<th scope="row">Admin</th>
								<td>
									上に加えて、等級と権限の変更、登録の取り消し、「設定」での配点の変更。誰がどの権限かを見られるのは
									Admin だけです。Admin が 0 人になる変更はできません。
								</td>
							</tr>
						</tbody>
					</table>
				</div>
				<p>
					権限は管理画面で何ができるかを決めるもので、評価シートで評価できるかどうかは、権限ではなく評価者の設定で決まります。
				</p>
			</section>

			<section class="info-card" id="help-account">
				<h2>ログインと登録</h2>
				<ul>
					<li>ログインには社員番号とパスワードを使います。</li>
					<li>
						はじめて使うときは新規登録をします。メールアドレスは、登録時の確認コードと通知メールの受け取りに使います。
					</li>
					<li>
						パスワードを忘れたときは、Admin
						に社員マスタで「登録の取り消し」をしてもらい、新規登録をやり直してください。評価シートなどのデータは残ります。
					</li>
				</ul>
			</section>
		</div>
	);
};

export default HelpView;
