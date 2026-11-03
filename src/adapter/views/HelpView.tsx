import ArrowRight from "lucide-solid/icons/arrow-right";
import ChevronDown from "lucide-solid/icons/chevron-down";
import X from "lucide-solid/icons/x";
import ZoomIn from "lucide-solid/icons/zoom-in";
import {
	type Component,
	createSignal,
	For,
	type JSX,
	onCleanup,
	onMount,
	type ParentComponent,
	Show,
} from "solid-js";
import { EvaluationAllocation } from "../../domain/valueObjects/EvaluationAllocation";
import { EvaluationRank } from "../../domain/valueObjects/EvaluationRank";
import {
	EvaluationStatus,
	type EvaluationStatusValue,
	type SheetActor,
} from "../../domain/valueObjects/EvaluationStatus";
import { GoalReturnReason } from "../../domain/valueObjects/GoalReturnReason";
import { PeriodDivision } from "../../domain/valueObjects/PeriodDivision";
import { PeriodState } from "../../domain/valueObjects/PeriodState";
import { helpShot } from "./helpShots";
import "./styles/help.css";

/*
 * ヘルプ兼、導入説明会の資料。上から順に流すと、登録から期の締めまでが一続きで分かるよう章に分ける。
 * 状態の順番・担当・通知の宛先・ランクの区切りは、ドメインの定義から組み立てる(仕様が変われば図も変わる)。
 */

/** 会社の設定のうち、説明に使うもの。読めないときは既定の配点を例として出す。 */
export interface HelpSettings {
	objective: number;
	common: number;
	maxChallengeGoals: number;
}

interface HelpImage {
	/** マニュアルの画面写真の名前。写真が無ければ表示しない(helpShots)。 */
	shot: string;
	caption: string;
	width: number;
	height: number;
	/** 手順の中では操作欄だけを切り出して見せる。拡大すると画面全体。 */
	preview?: { x: number; y: number; width: number; height: number };
}

const page = (shot: string, caption: string): HelpImage => ({
	shot,
	caption,
	width: 1280,
	height: 800,
});

const IMAGES = {
	registration: page("user/03-register-code", "新規登録の入力項目"),
	create: {
		...page("user/05-new-sheet", "評価期間の選択・シート作成"),
		preview: { x: 24, y: 156, width: 536, height: 278 },
	},
	goal: { shot: "user/07-goal", caption: "目標の入力と保存", width: 1216, height: 926 },
	submit: {
		...page("user/08-submit", "目標送信の確認"),
		preview: { x: 404, y: 251, width: 472, height: 298 },
	},
	request: page("user/18-request-evaluation", "一次評価の依頼"),
	previous: {
		shot: "user/15-previous-goals",
		caption: "前期のチャレンジ目標",
		width: 1216,
		height: 274,
	},
	workspace: page("evaluator/01-workspace", "部下の評価の一覧"),
	goalReview: page("evaluator/14-goal-review", "送信された目標の確認"),
	score: page("evaluator/03-goal-score", "チャレンジ目標の採点"),
	common: page("evaluator/04-common-score", "共通評価の採点"),
	overall: page("evaluator/05-overall", "総評"),
	confirm: page("evaluator/06-confirm-first", "一次評価の確定"),
	second: page("evaluator/09-second-score", "二次評価の採点"),
	result: page("user/10-sheet-list-final", "評価結果の PDF 出力"),
	overview: page("admin/01-overview", "全社の評価シート"),
	periodSwitch: page("admin/07-period-switch", "評価期間の切り替え"),
	corrections: {
		shot: "user/16-corrections",
		caption: "締め後修正の記録",
		width: 1216,
		height: 243,
	},
} satisfies Record<string, HelpImage>;

// 手順内は操作欄を中心に表示し、拡大時は元の画面全体を表示する。
const previewStyle = (image: HelpImage) => {
	const crop = image.preview;
	return crop
		? {
				"aspect-ratio": `${crop.width} / ${crop.height}`,
				"--help-image-width": `${(image.width / crop.width) * 100}%`,
				"--help-image-left": `${(-crop.x / crop.width) * 100}%`,
				"--help-image-top": `${(-crop.y / crop.height) * 100}%`,
			}
		: undefined;
};

type ShotSource = (name: string) => string | undefined;

const HelpScreenshot: Component<{
	image: HelpImage;
	shot: ShotSource;
	onOpen: (image: HelpImage) => void;
}> = (props) => (
	<Show when={props.shot(props.image.shot)}>
		{(src) => (
			<figure class="guide-shot">
				<button
					type="button"
					class="guide-shot__button"
					aria-label={`${props.image.caption}を拡大`}
					aria-haspopup="dialog"
					aria-controls="help-image-viewer"
					onClick={() => props.onOpen(props.image)}
				>
					<div
						class="guide-shot__preview"
						classList={{ "guide-shot__preview--cropped": !!props.image.preview }}
						style={previewStyle(props.image)}
					>
						<img
							src={src()}
							alt={props.image.caption}
							width={props.image.width}
							height={props.image.height}
							loading="lazy"
							decoding="async"
						/>
					</div>
					<span>
						<ZoomIn size={16} aria-hidden="true" />
						拡大
					</span>
				</button>
				<figcaption>{props.image.caption}</figcaption>
			</figure>
		)}
	</Show>
);

// ---------------------------------------------------------------- 章

const CHAPTERS = [
	{ id: "overview", title: "評価のしくみ", short: "しくみ", who: "全員" },
	{ id: "start", title: "登録とログイン", short: "登録", who: "全員" },
	{ id: "flow", title: "シートの流れ", short: "流れ", who: "全員" },
	{ id: "write", title: "目標を書く", short: "目標", who: "評価を受ける人" },
	{ id: "review", title: "評価する", short: "評価", who: "評価者" },
	{ id: "score", title: "評価点・ランクと結果", short: "点数", who: "全員" },
	{ id: "notice", title: "通知", short: "通知", who: "全員" },
	{ id: "close", title: "期の終わりと次の期", short: "期末", who: "全員・管理者" },
	{ id: "faq", title: "困ったとき", short: "Q&A", who: "全員" },
] as const;
type ChapterId = (typeof CHAPTERS)[number]["id"];

const chapterNumber = (id: ChapterId) =>
	String(CHAPTERS.findIndex((chapter) => chapter.id === id) + 1).padStart(2, "0");

const Chapter: ParentComponent<{ id: ChapterId; lead: string }> = (props) => {
	const chapter = CHAPTERS.find((candidate) => candidate.id === props.id);
	return (
		<section id={props.id} class="guide-chapter" aria-labelledby={`${props.id}-title`}>
			<header class="guide-chapter__head">
				<span class="guide-chapter__number" aria-hidden="true">
					{chapterNumber(props.id)}
				</span>
				<div>
					<p class="guide-chapter__who">{chapter?.who}</p>
					<h2 id={`${props.id}-title`}>{chapter?.title}</h2>
					<p class="guide-chapter__lead">{props.lead}</p>
				</div>
			</header>
			{props.children}
		</section>
	);
};

interface Step {
	title: string;
	body: JSX.Element;
	who?: string;
	tip?: string;
	image?: HelpImage;
}

/** 番号付きの手順。写真があれば右に並べる。 */
const Steps: Component<{
	label: string;
	steps: Step[];
	start?: number;
	shot: ShotSource;
	onOpen: (image: HelpImage) => void;
}> = (props) => (
	<ol class="guide-steps" aria-label={props.label}>
		<For each={props.steps}>
			{(step, index) => (
				<li classList={{ "guide-steps__item--plain": !step.image || !props.shot(step.image.shot) }}>
					<span class="guide-steps__number" aria-hidden="true">
						{(props.start ?? 1) + index()}
					</span>
					<div class="guide-steps__text">
						<h4>
							<Show when={step.who}>
								<span class="guide-who">{step.who}</span>
							</Show>
							{step.title}
						</h4>
						<p>{step.body}</p>
						<Show when={step.tip}>
							<p class="guide-steps__tip">{step.tip}</p>
						</Show>
					</div>
					<Show when={step.image}>
						{(image) => <HelpScreenshot image={image()} shot={props.shot} onOpen={props.onOpen} />}
					</Show>
				</li>
			)}
		</For>
	</ol>
);

// ---------------------------------------------------------------- シートの流れ

const ACTOR: Record<SheetActor, string> = {
	subject: "本人",
	primary: "一次評価者",
	secondary: "二次評価者",
};

/** その状態へ進める(戻す)ボタン。誰が押すかは EvaluationStatus.movedBy。 */
const ENTER_ACTION: Record<EvaluationStatusValue, string> = {
	draft: "要修正として下書きに戻す",
	goals_submitted: "目標を送信する",
	goals_confirmed: "目標を確定する",
	submitted: "一次評価を依頼する",
	first_evaluated: "一次評価を確定する",
	finalized: "二次評価を確定する",
};

/** その状態の間に、ボールを持つ人がすること。別の道があれば alt。 */
const STATE_GUIDE: Record<EvaluationStatusValue, { doing: string; alt?: string }> = {
	draft: {
		doing:
			"本人がチャレンジ目標と期中目標を書きます。評価者には見えません。要修正で戻ったときは、上部の理由を読んで直します。",
	},
	goals_submitted: {
		doing: "一次評価者が目標を読みます。本人は見るだけです。",
		alt: `直してほしいときは「${ENTER_ACTION.draft}」（理由を添えて）`,
	},
	goals_confirmed: {
		doing: "目標は固定。本人が期中から期末にかけて、達成状況だけを書き足します。",
	},
	submitted: {
		doing: "一次評価者が採点し、項目ごとのコメントと総評を書きます。本人はもう直せません。",
		alt: "二次評価者「なし」の部下は「評価を確定する」でそのまま評価確定",
	},
	first_evaluated: {
		doing: "二次評価者が一次評価を見たうえで採点し直し、総評を書きます。",
	},
	finalized: {
		doing: "誰も変更できません。点数とランクを確かめ、PDF に出力します。",
	},
};

const LANES: readonly SheetActor[] = ["subject", "primary", "secondary"];
const FLOW = { width: 1040, label: 116, column: 154, card: 118, cardHeight: 56, lane: 104 };
const cardX = (index: number) => FLOW.label + index * FLOW.column + (FLOW.column - FLOW.card) / 2;
const centerX = (index: number) => cardX(index) + FLOW.card / 2;
const laneY = (actor: SheetActor) => LANES.indexOf(actor) * FLOW.lane + FLOW.lane / 2;
/** 状態の札を置く段。評価確定は持ち主がいないので、確定した人の段から矢印を受ける。 */
const laneOf = (status: EvaluationStatus) => laneY(status.holder() ?? status.movedBy());

/** 担当ごとの段に状態の札を置き、ボールが行き来する様子を描く。 */
const FlowDiagram: Component = () => {
	const statuses = EvaluationStatus.ALL;
	const last = statuses.length - 1;
	const height = LANES.length * FLOW.lane;
	const half = FLOW.cardHeight / 2;
	const draft = EvaluationStatus.DRAFT.order();
	const sent = EvaluationStatus.GOALS_SUBMITTED.order();
	const requested = EvaluationStatus.SUBMITTED.order();
	const returnY = laneOf(EvaluationStatus.GOALS_SUBMITTED) + 14;
	const skipY = laneOf(EvaluationStatus.SUBMITTED) - 14;
	return (
		<div class="guide-flow">
			<svg
				viewBox={`0 0 ${FLOW.width} ${height}`}
				role="img"
				aria-labelledby="guide-flow-title"
				aria-describedby="guide-flow-desc"
			>
				<title id="guide-flow-title">評価シートの状態と、ボールを持つ人</title>
				<desc id="guide-flow-desc">
					本人・一次評価者・二次評価者の段に状態を並べ、番号の順にシートが受け渡されます。下の表と同じ内容です。
				</desc>
				<defs>
					<marker
						id="guide-arrow"
						viewBox="0 0 10 10"
						refX="8"
						refY="5"
						markerWidth="7"
						markerHeight="7"
						orient="auto-start-reverse"
					>
						<path d="M0 0L10 5L0 10z" class="guide-flow__head" />
					</marker>
				</defs>
				<For each={LANES}>
					{(actor, index) => (
						<g class="guide-flow__lane" classList={{ "guide-flow__lane--alt": index() % 2 === 1 }}>
							<rect x="0" y={index() * FLOW.lane} width={FLOW.width} height={FLOW.lane} />
							<text x="20" y={laneY(actor) + 5}>
								{ACTOR[actor]}
							</text>
						</g>
					)}
				</For>
				<g class="guide-flow__arrows" marker-end="url(#guide-arrow)">
					<For each={statuses.slice(0, last)}>
						{(from, index) => {
							const x = cardX(index()) + FLOW.card;
							const middle = x + (FLOW.column - FLOW.card) / 2;
							const y1 = laneOf(from);
							const y2 = laneOf(statuses[index() + 1]);
							return <path d={`M${x} ${y1}H${middle}V${y2}H${cardX(index() + 1) - 3}`} />;
						}}
					</For>
					<path
						class="guide-flow__alt"
						d={`M${cardX(sent)} ${returnY}H${centerX(draft)}V${laneOf(EvaluationStatus.DRAFT) + half + 3}`}
					/>
					<path
						class="guide-flow__alt"
						d={`M${cardX(requested) + FLOW.card} ${skipY}H${cardX(last) - 3}`}
					/>
				</g>
				<g class="guide-flow__notes">
					<text x={centerX(draft)} y={returnY + 22}>
						要修正で戻す
					</text>
					<text x={centerX(requested + 1)} y={skipY - 10}>
						二次評価者なし
					</text>
				</g>
				<For each={statuses.slice(0, last)}>
					{(from, index) => {
						const middle = cardX(index()) + FLOW.card + (FLOW.column - FLOW.card) / 2;
						const y = (laneOf(from) + laneOf(statuses[index() + 1])) / 2;
						return (
							<g class="guide-flow__badge">
								<circle cx={middle} cy={y} r="11" />
								<text x={middle} y={y + 4}>
									{index() + 1}
								</text>
							</g>
						);
					}}
				</For>
				<For each={statuses}>
					{(status, index) => {
						const final = index() === last;
						const y = final ? 16 : laneOf(status) - half;
						const h = final ? height - 32 : FLOW.cardHeight;
						return (
							<g class="guide-flow__card" classList={{ "guide-flow__card--final": final }}>
								<rect x={cardX(index())} y={y} width={FLOW.card} height={h} rx="8" />
								<text x={centerX(index())} y={y + h / 2 + 5}>
									{status.label()}
								</text>
								<Show when={final}>
									<text class="guide-flow__sub" x={centerX(index())} y={y + h / 2 + 26}>
										変更できない
									</text>
								</Show>
							</g>
						);
					}}
				</For>
			</svg>
		</div>
	);
};

const StateTable: Component = () => {
	const statuses = EvaluationStatus.ALL;
	return (
		<div class="guide-table-wrap">
			<table class="guide-table guide-table--states">
				<caption>シートの状態と担当</caption>
				<thead>
					<tr>
						<th scope="col">状態</th>
						<th scope="col">担当</th>
						<th scope="col">この間にすること</th>
						<th scope="col">次へ進める操作</th>
					</tr>
				</thead>
				<tbody>
					<For each={statuses}>
						{(status, index) => {
							const next = statuses[index() + 1];
							const holder = status.holder();
							const guide = STATE_GUIDE[status.toString()];
							return (
								<tr>
									<th scope="row">{status.label()}</th>
									<td>{holder ? <span class="guide-who">{ACTOR[holder]}</span> : "なし"}</td>
									<td>{guide.doing}</td>
									<td>
										<Show when={next} fallback="—">
											{(to) => (
												<>
													<span class="guide-badge">{index() + 1}</span>
													{ACTOR[to().movedBy()]}が「{ENTER_ACTION[to().toString()]}」
													<Show when={guide.alt}>
														<small>{guide.alt}</small>
													</Show>
												</>
											)}
										</Show>
									</td>
								</tr>
							);
						}}
					</For>
				</tbody>
			</table>
		</div>
	);
};

// ---------------------------------------------------------------- 評価点

/** 説明に使う例: チャレンジ目標1つを 4、共通評価が満点 20 点のうち 17 点。 */
const scoreExample = (allocation: { objective: number; common: number }) => {
	const objective = EvaluationAllocation.fromTotal(allocation.objective, 4, 4);
	const common = EvaluationAllocation.fromTotal(allocation.common, 17, 20);
	const total = objective + common;
	return {
		objective,
		common,
		total,
		rank: EvaluationRank.fromScore(total, EvaluationAllocation.TOTAL).toDisplayText(),
	};
};

/** 0〜100 点の帯を、ランクの区切りで塗り分ける。 */
const RankScale: Component = () => {
	const bands = [...EvaluationRank.bands()].reverse();
	const upper = (index: number) => bands[index + 1]?.minimum ?? EvaluationAllocation.TOTAL;
	return (
		<div class="guide-ranks">
			<ol class="guide-ranks__bar" aria-label="評価点とランク">
				<For each={bands}>
					{(band, index) => (
						<li
							style={{
								"flex-grow": upper(index()) - band.minimum,
								"--guide-rank-mix": `${8 + index() * 6}%`,
							}}
						>
							<strong>{band.rank.toDisplayText()}</strong>
							<span class="visually-hidden">
								{band.minimum === 0
									? `${upper(index())}点未満`
									: `${band.minimum}点以上${upper(index())}点未満`}
							</span>
						</li>
					)}
				</For>
			</ol>
			<div class="guide-ranks__ticks" aria-hidden="true">
				<For each={[...bands.map((band) => band.minimum), EvaluationAllocation.TOTAL]}>
					{(value) => (
						<span class="guide-ranks__tick" style={{ left: `${value}%` }}>
							{value}
						</span>
					)}
				</For>
			</div>
		</div>
	);
};

// ---------------------------------------------------------------- よくある質問

const FAQ: { title: string; items: [string, string][] }[] = [
	{
		title: "記入・送信",
		items: [
			[
				"送信した目標を直したい",
				"目標確認待ちの間に、一次評価者に要修正として下書きへ戻してもらいます。達成状況は、一次評価者が目標を確定してから「達成状況を入力」で書けます（下書き・目標確認待ちの間は書けません）。「一次評価を依頼する」を押して一次評価待ちになると、本人による修正はできません。",
			],
			[
				"「新規作成」が押せない",
				"今の評価期間のシートはもう作ってあります。一覧からシートを開いてください。作れるのは実施中の評価期間のシートだけです。",
			],
			[
				"「チャレンジ目標が空欄の目標は送信・確定できません」と出る",
				"空のタブにチャレンジ目標を書いて保存するか、そのタブを「この目標を削除」で消します。",
			],
			[
				"前期の目標が別の番号に入った",
				"同じ番号を今期の別の目標が使っていたためです。番号が違っても、前期とのつながりは残ります。",
			],
			[
				"締め済みの評価期間",
				"締め済みのシートは閲覧用です。評価確定のシートは PDF 出力できます。未確定のまま締める設定の期間では、未確定のシートも出力でき、点数・ランク・評価コメントは「***」で表示されます。",
			],
		],
	},
	{
		title: "評価",
		items: [
			[
				"部下のシートを開けない",
				"本人が目標を送信していないシート（未作成・目標の送信待ち）は開けません。実施中の期間の下書きは評価者に表示されません。本人に送信を促してください。",
			],
			[
				"確定ボタンを押すと止まる",
				"チャレンジ目標と共通評価の全項目に1〜4の点数が必要です。「自分の評価: あと〇件」から未評価の項目へ移って採点し、保存してください。",
			],
			[
				"二次評価を入力できない",
				"一次評価者の確定を待っています。一覧で「一次評価待ち」になっていないか確認してください。",
			],
			[
				"確定した点数を直したい",
				"確定した段階の評価は、本人・評価者からは変更できません。管理者に相談してください。締め済みの期間は、管理者が「遡及処理」で理由を記録して直します。",
			],
			[
				"部下が一覧に出てこない",
				"あなたが評価者に設定されていない可能性があります。社員マスタで確認し、管理者に依頼してください。",
			],
		],
	},
	{
		title: "登録・ログイン",
		items: [
			[
				"認証コードと招待コード",
				"認証コードはメールで受信します。招待コードは管理者が社員ごとに発行し、有効期限は7日間、使用は1回限りです。紛失・期限切れの場合は再発行を依頼してください。",
			],
			[
				"パスワードを忘れた",
				"管理者に登録の取り消しと招待コードの発行を依頼し、新規登録をやり直します。評価シートは引き継がれます。",
			],
			[
				"「利用が停止されています」と出る",
				"利用の再開を管理者に依頼してください。パスワードの変更や新規登録では解除できません。",
			],
		],
	},
	{
		title: "通知・メール",
		items: [
			[
				"ベルの未読",
				"ベルの数字は、未読の依頼の数です。依頼を選ぶとシートが開き、既読になります。評価が次の段階に進んだ依頼は自動で既読になり、一次評価者が要修正として戻した依頼は取り下げられます。",
			],
			[
				"メールの送信失敗と再送",
				"通知の方法がメールのときの案内です。送信に失敗しても、状態の変更は完了しています。目標確認待ち・一次評価待ちでは本人、振り返り待ち・二次評価待ちでは一次評価者が、シート上部の「通知を再送」を使えます。待機時間や回数制限が表示された場合は、画面の案内に従ってください。",
			],
			[
				"送信済みのメールが届かない",
				"迷惑メールフォルダーと共有メールの受信箱を確認してください。送信済みの通知は再送されません。見つからない場合は、管理者に宛先と配送状況の確認を依頼してください。",
			],
			[
				"テストメールが送れない（HandshakeFailure と出る）",
				"メールサーバーの暗号化の方式が古く、TYPA のサーバーがつながれないときの表示です。古い方式（RSA 鍵交換）は、通信を記録されると後から解読されるおそれがあるため、TYPA のサーバーは使いません。メールサーバーの管理元に「ECDHE の暗号化方式を有効にしてほしい」と依頼するか、別のメールサービスを使ってください。それまではアプリ内通知で運用できます。",
			],
			[
				"Outlook では同じ設定で送れるのに",
				"Outlook は Windows の暗号化の機能を使っていて、古い方式にもまだ対応しています。TYPA のメールは Supabase のサーバー（Edge Function）から送り、そこでは古い方式が使えません。設定の誤りではありません。",
			],
			[
				"暗号化しないで送れないのか",
				"送りません。暗号化しないと、メールサーバーのパスワードと評価の依頼の内容が、そのまま通信経路に流れます。TYPA は、暗号化できない接続ではメールを送りません。ポートは 465（暗号化された接続）を使います。587 と 25 は TYPA のサーバーからつながりません。",
			],
		],
	},
	{
		title: "管理者の操作",
		items: [
			[
				"社員の仮登録",
				"ユーザーメニューの「導入処理」→「初期ユーザ」を開きます。社員番号・氏名・キャリアコース・等級を入力して仮登録します。一次・二次評価者は任意です。登録後に社員マスタで招待コードを発行します。",
			],
			[
				"招待コードの発行",
				"社員マスタで未登録の社員の「招待コード」を押し、表示されたコードを本人に渡します。「招待コードを一括発行」も使えます。閉じたコードは再表示できません。再発行すると以前のコードは無効になります。",
			],
			[
				"登録取消・利用停止・利用再開",
				"登録をやり直す場合は「取消」、利用を止める場合は「利用停止」を使います。評価シートは削除されません。「利用再開」後、登録済みの社員は同じ社員番号・パスワードでログインできます。未登録の社員には招待コードが必要です。",
			],
			[
				"等級・評価者・権限・ログイン保持",
				"Adminが社員マスタで設定します。等級の変更は新しく作るシートに適用され、評価者の変更は実施中の未確定シートに反映されます。共有PCを使う社員の「ログイン」は「閉じたらログアウト」に設定してください。利用可能な登録済みAdminを1名以上残す必要があります。",
			],
			[
				"締め済みシートの訂正",
				"ユーザーメニューの「遡及処理」で評価期間とシートを選び、「値を直す」で修正内容と理由を入力して記録します。期間は締め済みのままです。状態の変更と削除も同じ画面で、どの期間のシートにも行えます。",
			],
			[
				"操作の記録（監査ログ）",
				"ユーザーメニューの「監査ログ」で、社員マスタの変更、シートの状態の移り変わり、遡及処理、データの取込を、誰がいつ行ったか新しい順に確認できます。種類・対象の社員・操作した人・期間で絞り込めます。遡及処理の記録には朱の印が付き、理由も表示されます。記録はアプリから書き換えも削除もできません。",
			],
		],
	},
	{
		title: "アプリの更新",
		items: [
			[
				"更新のお知らせが出た",
				"入力を保存して「今すぐ更新」を押します。更新が済むと、アプリが自動で開き直します（PCは再起動しません）。作業を続ける場合は「あとで」を選びます。未保存の入力がある場合は、インストール前に確認画面が表示されます。ブラウザ版は更新のお知らせが出ず、開くたびに新しい版になります。PDF は保存先を選ばず、ブラウザのダウンロード先に保存されます。",
			],
		],
	},
];

// ---------------------------------------------------------------- 画面

/**
 * shot: 画面写真の探し方。テストでは撮っていない写真の代わりを渡す。
 * settings: 配点とチャレンジ目標の上限。会社の値で説明する。
 */
const HelpView: Component<{ shot?: ShotSource; settings?: () => Promise<HelpSettings> }> = (
	props,
) => {
	const shot: ShotSource = (name) => (props.shot ?? helpShot)(name);
	const [settings, setSettings] = createSignal<HelpSettings>();
	const [current, setCurrent] = createSignal<ChapterId>(CHAPTERS[0].id);
	const [selectedImage, setSelectedImage] = createSignal<HelpImage | null>(null);
	let imageDialog: HTMLDialogElement | undefined;
	const openImage = (image: HelpImage) => {
		setSelectedImage(image);
		imageDialog?.showModal();
	};
	const allocation = () => settings() ?? EvaluationAllocation.DEFAULT;
	const example = () => scoreExample(allocation());
	const steps = { shot, onOpen: openImage };

	onMount(() => {
		props
			.settings?.()
			.then(setSettings)
			.catch((error) => console.error("Error loading the evaluation settings:", error));
		// いま映している章を、横の目次で示す(説明会で画面を流すときの現在地)
		const observer = new IntersectionObserver(
			(entries) => {
				const visible = entries.find((entry) => entry.isIntersecting);
				if (visible) {
					setCurrent(visible.target.id as ChapterId);
				}
			},
			{ rootMargin: "-30% 0px -60% 0px" },
		);
		for (const chapter of CHAPTERS) {
			const element = document.getElementById(chapter.id);
			if (element) {
				observer.observe(element);
			}
		}
		onCleanup(() => observer.disconnect());
	});

	return (
		<div class="guide">
			<nav class="guide-rail" aria-label="章の移動">
				<ol>
					<For each={CHAPTERS}>
						{(chapter) => (
							<li>
								<a
									class="guide-rail__link"
									href={`#${chapter.id}`}
									aria-current={current() === chapter.id ? "location" : undefined}
								>
									<span class="guide-rail__number" aria-hidden="true">
										{chapterNumber(chapter.id)}
									</span>
									{chapter.short}
								</a>
							</li>
						)}
					</For>
				</ol>
			</nav>

			<article class="guide-body">
				<header class="guide-cover">
					<p class="guide-cover__eyebrow">TYPA 人事評価 ヘルプ</p>
					<h1>評価のしくみと使い方</h1>
					<p class="guide-cover__lead">
						評価シートを書く人、評価する人、運用する人が、同じ図で1期の流れを確かめるためのガイドです。上から順に読むと、登録から期の締めまでがひと通り分かります。
					</p>
					<nav class="guide-toc" aria-label="目次">
						<ol>
							<For each={CHAPTERS}>
								{(chapter) => (
									<li>
										<a href={`#${chapter.id}`}>
											<span class="guide-toc__number" aria-hidden="true">
												{chapterNumber(chapter.id)}
											</span>
											<span class="guide-toc__title">{chapter.title}</span>
											<span class="guide-toc__who">{chapter.who}</span>
										</a>
									</li>
								)}
							</For>
						</ol>
					</nav>
				</header>

				<Chapter
					id="overview"
					lead="評価は「評価期間」ごとに、1人1枚の評価シートを、本人・一次評価者・二次評価者の3人で回して進めます。"
				>
					<dl class="guide-cards">
						<div>
							<dt>期と評価期間</dt>
							<dd>
								「26期」のような年度を、通年・半期・四半期に分けた一つひとつが評価期間です。評価は評価期間ごとに完結し、上期と下期の点数を合わせることはしません。
							</dd>
						</div>
						<div>
							<dt>評価シート</dt>
							<dd>
								評価期間ごとに1人1枚。本人が作って目標を書き、評価者に回します。共通評価の項目は、作った時点の等級で決まります。
							</dd>
						</div>
						<div>
							<dt>3人で回す</dt>
							<dd>
								本人・一次評価者・二次評価者（最終評価）。二次評価者が「なし」の社員は、一次評価がそのまま最終評価です。誰が誰を評価するかは、管理者が社員マスタで決めます。
							</dd>
						</div>
					</dl>

					<h3>役割と使う画面</h3>
					<div class="guide-table-wrap">
						<table class="guide-table">
							<thead>
								<tr>
									<th scope="col">役割</th>
									<th scope="col">主に使う画面</th>
									<th scope="col">すること</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<th scope="row">本人</th>
									<td>評価シート</td>
									<td>
										目標と達成状況を書き、「目標を送信する」「一次評価を依頼する」で評価者へ回す
									</td>
								</tr>
								<tr>
									<th scope="row">一次評価者</th>
									<td>部下の評価</td>
									<td>目標を確認して確定し、期末に採点・総評を書いて確定する</td>
								</tr>
								<tr>
									<th scope="row">二次評価者</th>
									<td>部下の評価</td>
									<td>一次評価を見たうえで採点し直し、最終評価を確定する</td>
								</tr>
								<tr>
									<th scope="row">管理者（Admin）</th>
									<td>社員マスタ・設定</td>
									<td>評価者と等級の設定、評価期間の開始と締め、締めた後の修正</td>
								</tr>
							</tbody>
						</table>
					</div>

					<h3>1つの評価期間の流れ</h3>
					<ol class="guide-season" aria-label="1つの評価期間の流れ">
						<li>
							<strong>期初</strong>
							<span>本人がシートを作り、目標を書いて送信。一次評価者が目標を確定します。</span>
						</li>
						<li>
							<strong>期中</strong>
							<span>本人が達成状況を書き足します。</span>
						</li>
						<li>
							<strong>期末</strong>
							<span>本人が一次評価を依頼。一次評価、二次評価の順に確定します。</span>
						</li>
						<li>
							<strong>締め</strong>
							<span>管理者が次の評価期間を開始すると、今の評価期間は締まります。</span>
						</li>
					</ol>
				</Chapter>

				<Chapter
					id="start"
					lead="初めて使うときに一度だけ新規登録をします。ログインは社員番号とパスワードで行います。"
				>
					<h3>用意するもの</h3>
					<dl class="guide-cards guide-cards--four">
						<div>
							<dt>社員番号</dt>
							<dd>管理者から受け取ります。ログイン ID になります。</dd>
						</div>
						<div>
							<dt>招待コード</dt>
							<dd>管理者が社員ごとに発行します。有効期限は7日間、使えるのは1回だけです。</dd>
						</div>
						<div>
							<dt>認証コード</dt>
							<dd>会社の指定ドメインのメールアドレスに届きます。共有メールも使えます。</dd>
						</div>
						<div>
							<dt>パスワード</dt>
							<dd>6文字以上で、大文字・小文字・数字をすべて含めます。</dd>
						</div>
					</dl>
					<Steps
						label="新規登録の手順"
						{...steps}
						steps={[
							{
								title: "メールアドレスで認証コードを受け取る",
								body: "ログイン画面の「新規登録」を押し、メールアドレスを入れて「認証コードを受け取る」を押します。",
							},
							{
								title: "コードとパスワードを入れて登録する",
								body: "届いた認証コード、社員番号、招待コード、パスワード（確認用も）を入れて「登録する」を押します。社員番号の確認画面で番号を控え、「覚えました」を押すと評価シート一覧が開きます。",
								tip: "「認証コード」はメールで届くコード、「招待コード」は管理者から受け取るコードです。両方が必要です。",
								image: IMAGES.registration,
							},
						]}
					/>
					<h3>画面の見かた</h3>
					<div class="guide-table-wrap">
						<table class="guide-table">
							<thead>
								<tr>
									<th scope="col">画面上部</th>
									<th scope="col">内容</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<th scope="row">評価シート</th>
									<td>自分の評価シートの作成・閲覧、評価期間の切り替え、PDF 出力</td>
								</tr>
								<tr>
									<th scope="row">部下の評価</th>
									<td>評価者を務める人だけに表示されます</td>
								</tr>
								<tr>
									<th scope="row">社員マスタ</th>
									<td>自分の等級・一次評価者・二次評価者の確認</td>
								</tr>
								<tr>
									<th scope="row">ベル</th>
									<td>あなたの番になった評価の依頼が届きます</td>
								</tr>
								<tr>
									<th scope="row">自分の名前</th>
									<td>画面の明るさ、ヘルプ、ログアウト（管理者は設定・遡及処理なども）</td>
								</tr>
							</tbody>
						</table>
					</div>
					<p class="guide-note">
						共有PCでは、終わったら必ず右上の自分の名前から「ログアウト」してください。パスワードを忘れたときは、管理者に登録の取り消しと招待コードの再発行を頼みます（評価シートは残ります）。
					</p>
				</Chapter>

				<Chapter
					id="flow"
					lead="シートは6つの状態を順に進みます。いつも誰か1人がボールを持っていて、その人が操作するまで次へは進みません。"
				>
					<FlowDiagram />
					<StateTable />
					<h3>押さえておくこと</h3>
					<ul class="guide-points">
						<li>
							<strong>保存しただけでは進まない</strong>
							<span>
								「目標を送信する」「一次評価を依頼する」「確定する」を押して、初めて次の人へ回ります。
							</span>
						</li>
						<li>
							<strong>下書きは評価者に見えない</strong>
							<span>評価者がシートを読めるのは、本人が目標を送信してからです。</span>
						</li>
						<li>
							<strong>依頼・確定は戻せない</strong>
							<span>
								一次評価を依頼した後は本人が、確定した後は評価者も直せません。押す前に見直します。
							</span>
						</li>
					</ul>
				</Chapter>

				<Chapter
					id="write"
					lead="期初に目標を書いて送信し、目標が確定したら期中から期末に達成状況を書き足して、一次評価を依頼します。"
				>
					<h3>1つの目標は3段でできている</h3>
					<ol class="guide-goal" aria-label="目標の組み立て">
						<li>
							<strong>チャレンジ目標</strong>
							<span>
								この評価期間に達成すること。数値や期限を入れて書きます。
								{settings()
									? `1枚に 1〜${settings()?.maxChallengeGoals} 件。`
									: "1枚に1件以上（上限は管理者が設定）。"}
							</span>
							<em>下書きの間に書く</em>
						</li>
						<li>
							<strong>期中目標</strong>
							<span>チャレンジ目標に向けて、この期に取り組むこと。各 0〜4 件。</span>
							<em>下書きの間に書く</em>
						</li>
						<li>
							<strong>達成状況</strong>
							<span>
								期中目標ごとの実績や結果。期中目標が0件なら、チャレンジ目標に対して書きます。
							</span>
							<em>目標の確定後（振り返り待ち）に書く</em>
						</li>
					</ol>

					<h3>期初：目標を書いて送信する</h3>
					<Steps
						label="期初の手順"
						{...steps}
						steps={[
							{
								title: "評価シートを作る",
								body: "「評価シート」で「新規作成」を押し、評価対象期間を選んで「評価シートを作成」を押します。",
								tip: "作れるのは実施中の評価期間のシートだけ、1人1枚です。",
								image: IMAGES.create,
							},
							{
								title: "目標を書いて保存する",
								body: "「目標を編集」を押し、チャレンジ目標と期中目標を書いて「目標を保存」を押します。保存は目標のタブごとです。",
								tip: "目標を増やすときは「目標を追加」。空のタブが残っていると送信できません。",
								image: IMAGES.goal,
							},
							{
								title: "目標を送信する",
								body: "シート上部の「目標を送信する」を押し、確認画面でもう一度押します。状態が「目標確認待ち」になります。",
								tip: "一次評価者が確定すると「振り返り待ち」で本人の番に戻ります。要修正で戻されたら、理由を読んで直し、もう一度送信します。",
								image: IMAGES.submit,
							},
						]}
					/>

					<h3>期中〜期末：振り返って、評価を依頼する</h3>
					<Steps
						label="期中から期末の手順"
						start={4}
						{...steps}
						steps={[
							{
								title: "達成状況を書く",
								body: "「達成状況を入力」を押し、期中目標ごとに実績を書いて「達成状況を保存」を押します。目標の文言と件数は、もう変えられません。",
							},
							{
								title: "一次評価を依頼する",
								body: "書き終えたら、シート上部の「一次評価を依頼する」を押します。「一次評価待ち」になり、以後は本人は直せません。",
								image: IMAGES.request,
							},
						]}
					/>

					<h3>前期のチャレンジ目標を引き継ぐ</h3>
					<div class="guide-split">
						<div>
							<p>
								前の評価期間にシートがあれば、下書きの間は「前期のチャレンジ目標」が並びます。続けたい目標だけ、目標ごとに選びます。引き継ぐのはチャレンジ目標の文言だけで、期中目標は毎期書き直します。
							</p>
							<dl class="guide-options">
								<div>
									<dt>据え置く</dt>
									<dd>前期の文言のまま入ります。「前期から据え置き」と表示されます。</dd>
								</div>
								<div>
									<dt>見直して更新</dt>
									<dd>
										前期の文言が入り、書き直す画面が開きます。書き換えて保存すると「前期から更新」です。
									</dd>
								</div>
							</dl>
						</div>
						<HelpScreenshot image={IMAGES.previous} shot={shot} onOpen={openImage} />
					</div>
				</Chapter>

				<Chapter
					id="review"
					lead="「部下の評価」に、あなたが評価者になっている部下が並びます。件数のタイルと一覧の輪で、あなたの番のシートが分かります。"
				>
					<div class="guide-split">
						<p>
							「目標を確認する」「一次評価する」「二次評価する」のタイルが、あなたの番の件数です。押すと一覧が絞り込まれ、「自分の番を評価する」で順に開けます。確定すると、次の自分の番のシートが自動で開きます。
						</p>
						<HelpScreenshot image={IMAGES.workspace} shot={shot} onOpen={openImage} />
					</div>

					<h3>一次評価者</h3>
					<Steps
						label="一次評価の手順"
						{...steps}
						steps={[
							{
								who: "期初",
								title: "送信された目標を確認する",
								body: "シートを開いて目標を読み、「目標を確定する」か「要修正として下書きに戻す」を選びます。",
								tip: `戻すときは理由が必須です（${GoalReturnReason.MAX_LENGTH} 文字まで）。理由はそのまま本人のシートに出ます。確定しても、本人が一次評価を依頼するまで採点はできません。`,
								image: IMAGES.goalReview,
							},
							{
								who: "期末",
								title: "チャレンジ目標を採点する",
								body: "目標のタブごとに、チャレンジ目標・期中目標・達成状況を読み、「評価を入力」→ 1〜4 を選ぶ →「評価を保存」。未採点のタブには「未評価」と出ます。",
								image: IMAGES.score,
							},
							{
								title: "共通評価を採点する",
								body: "共通評価の「評価を入力」を押し、項目ごとに 1〜4 を選び、必要ならコメントを書いて「評価を保存」。項目と配点は等級ごとに決まっています。",
								image: IMAGES.common,
							},
							{
								title: "総評を書く",
								body: "「一次評価者の総評」に評価の理由や今後への期待を書き、「総評を保存」を押します。",
								tip: "点数・コメント・総評は欄ごとに保存します。保存しないまま別の部下を開こうとすると確認が出ます。",
								image: IMAGES.overall,
							},
							{
								title: "一次評価を確定する",
								body: "右下の「一次評価を確定する」を押し、確認画面でランクと点数を確かめて確定します。二次評価者に依頼が届きます。",
								tip: "未採点の項目があると確定できません。「自分の評価: あと〇件」から未設定の項目へ移れます。",
								image: IMAGES.confirm,
							},
						]}
					/>

					<h3>二次評価者</h3>
					<div class="guide-split">
						<div>
							<p>
								一次評価が確定すると「二次評価する」に変わります。一次評価の点数・コメント・総評を見たうえで「二次評価」の欄で採点し、「二次評価者の総評」を書いて「二次評価を確定する」を押します。これが最終評価です。
							</p>
							<p class="guide-note">
								二次評価者が「なし」の部下は、一次評価者のボタンが「評価を確定する」になり、押すとそのまま評価確定です。「未設定」とは違います。未設定のまま止まっている部下は管理者に相談してください。
							</p>
						</div>
						<HelpScreenshot image={IMAGES.second} shot={shot} onOpen={openImage} />
					</div>

					<h3>評価をそろえる</h3>
					<ul class="guide-points">
						<li>
							<strong>比較</strong>
							<span>
								一覧の「比較」に最大6名チェックし「選択して比較」。点数・目標・コメントが横に並びます。
							</span>
						</li>
						<li>
							<strong>等級ごとに区切る</strong>
							<span>一覧を等級ごとに分けて、同じ等級の中で見比べます。</span>
						</li>
						<li>
							<strong>一次・二次の差が大きい順</strong>
							<span>二次評価者が、一次評価と大きく違う部下から確かめられます。</span>
						</li>
					</ul>
				</Chapter>

				<Chapter
					id="score"
					lead="点数は 1〜4 の4段階で付けます。評価点（100点満点）とランクは、その点数から自動で決まり、手で変えることはできません。"
				>
					<div class="guide-formula">
						<p class="guide-formula__label">
							{settings() ? "いまの配点（管理者が設定）" : "配点の例（実際の配点は管理者が設定）"}
						</p>
						<div class="guide-formula__row">
							<div>
								<span class="guide-formula__name">チャレンジ目標</span>
								<strong>{allocation().objective} 点</strong>
								<small>目標の点数の合計 ÷（目標の数 × 4）× 配点</small>
							</div>
							<span class="guide-formula__op" aria-hidden="true">
								＋
							</span>
							<div>
								<span class="guide-formula__name">共通評価</span>
								<strong>{allocation().common} 点</strong>
								<small>「項目の配点 × 評価」の合計 ÷（項目の配点の合計 × 4）× 配点</small>
							</div>
							<span class="guide-formula__op" aria-hidden="true">
								＝
							</span>
							<div>
								<span class="guide-formula__name">評価点</span>
								<strong>{EvaluationAllocation.TOTAL} 点</strong>
								<small>それぞれ配点を掛けた後に1点単位で四捨五入して足す</small>
							</div>
						</div>
					</div>

					<h3>評価点とランク</h3>
					<RankScale />
					<p class="guide-example">
						例：目標1つを 4、共通評価が 20 点満点中 17 点なら、{allocation().objective} × 4/4 ＋{" "}
						{allocation().common} × 17/20 ＝ {example().objective} ＋ {example().common} ＝{" "}
						<strong>
							{example().total} 点（{example().rank}）
						</strong>
					</p>

					<h3>誰に、いつ見えるか</h3>
					<ul class="guide-points">
						<li>
							<strong>本人</strong>
							<span>
								評価確定まで、点数もランクも見えません。確定後はシートに目標ごとの一次評価の点数が出て、共通評価・総評・評価点・ランクは
								PDF で確かめます。
							</span>
						</li>
						<li>
							<strong>一次評価者</strong>
							<span>二次評価の点数は、評価確定まで見えません。</span>
						</li>
						<li>
							<strong>確定前のランク</strong>
							<span>入力中の点数から計算した見込みとして、薄く表示されます。</span>
						</li>
					</ul>

					<h3>結果を PDF に保存する</h3>
					<div class="guide-split">
						<p>
							「評価シート一覧」で評価期間を選び、「PDF出力」を押します。本人は「自分の評価シート」、評価者は「部下の評価シート」から出力でき、誰が出しても同じ内容です。評価確定になる前は「確定後に
							PDF 出力」と表示されます。
						</p>
						<HelpScreenshot image={IMAGES.result} shot={shot} onOpen={openImage} />
					</div>
				</Chapter>

				<Chapter
					id="notice"
					lead="シートが次の人へ回ると、その人に依頼が届きます。届いた依頼を選ぶと、そのシートが開きます。"
				>
					<ul class="guide-notice" aria-label="通知の宛先">
						<For
							each={EvaluationStatus.ALL.flatMap((status) => {
								const handoff = status.handoff();
								return handoff ? [{ status, ...handoff }] : [];
							})}
						>
							{(notice) => (
								<li>
									<span class="guide-notice__action">
										{ACTOR[notice.from]}が「{ENTER_ACTION[notice.status.toString()]}」
									</span>
									<ArrowRight size={18} aria-hidden="true" />
									<span class="guide-who">{ACTOR[notice.to]}</span>
								</li>
							)}
						</For>
					</ul>
					<p class="guide-note">評価確定（最後の確定）は、誰にも通知しません。</p>
					<dl class="guide-cards guide-cards--two">
						<div>
							<dt>アプリ内通知（標準）</dt>
							<dd>
								画面上部のベルに未読の数が出ます。状態が変わると同時に届き、次の段階へ進んだ依頼は自動で既読になります。要修正で戻すと、届いていた依頼は取り下げられます。
							</dd>
						</div>
						<div>
							<dt>メール</dt>
							<dd>
								管理者がメールを選んだときは、登録時に確かめたアドレスに届きます。送信・依頼・確定の確認画面で、送るかどうかを選べます。届かないときはシート上部の「通知を再送」を使えます。
							</dd>
						</div>
					</dl>
				</Chapter>

				<Chapter
					id="close"
					lead="全員の評価が確定したら、管理者が次の評価期間を開始します。その瞬間に今の評価期間が締まり、シートは閲覧と PDF 出力だけになります。"
				>
					<h3>評価期間の一生</h3>
					<ol class="guide-season guide-season--three" aria-label="評価期間の状態">
						<For
							each={
								[
									[PeriodState.NOT_STARTED, "管理者が期を追加した段階。まだシートは作れません。"],
									[
										PeriodState.ACTIVE,
										"シートの作成・記入・評価・確定ができるのは、この期間だけ。実施中はいつも1つです。",
									],
									[PeriodState.CLOSED, "閲覧と PDF 出力だけ。もう一度開始することはできません。"],
								] as const
							}
						>
							{([state, note]) => (
								<li>
									<strong>{state.label}</strong>
									<span>{note}</span>
								</li>
							)}
						</For>
					</ol>

					<h3>期の分け方</h3>
					<ul class="guide-divisions" aria-label="期の分け方">
						<For each={PeriodDivision.ALL}>
							{(division) => (
								<li>
									<strong>{division.label}</strong>
									<span class="guide-divisions__bar">
										<For each={Array.from({ length: division.parts }, (_, index) => index + 1)}>
											{(part) => (
												<span class="guide-divisions__part">
													{division.partLabel(part) || "1年"}
												</span>
											)}
										</For>
									</span>
									<small>1つの期に {division.parts} 回評価</small>
								</li>
							)}
						</For>
					</ul>

					<h3>期末から次の期まで</h3>
					<Steps
						label="期末から次の期までの手順"
						{...steps}
						steps={[
							{
								who: "本人",
								title: "達成状況を仕上げて一次評価を依頼する",
								body: "依頼しないと評価が始まりません。期末の締め切りを社内で決めておくと進みます。",
							},
							{
								who: "評価者",
								title: "一次評価・二次評価を確定する",
								body: "一次評価者の確定で二次評価者に依頼が届き、二次評価者の確定で評価確定です。",
							},
							{
								who: "管理者",
								title: "止まっているシートに声をかける",
								body: "「評価シート」の下の「全社の評価シート」で、段階ごとの枚数を確かめ、送信・依頼・評価が止まっている人に声をかけます。シートを作っていない人は、評価者の「部下の評価」で「未作成」と出ます。",
								image: IMAGES.overview,
							},
							{
								who: "管理者",
								title: "等級と評価者を見直す",
								body: "昇級などの等級の変更と評価者の付け替えは、社員が次のシートを作る前に社員マスタで済ませます。等級は作った時点でシートに固定されます。",
							},
							{
								who: "管理者",
								title: "次の評価期間を開始する",
								body: "「設定」で次の評価期間の「この期間を開始する」を押します。今の評価期間は同時に締まります。未確定のシートが残っていると締められません（「評価が確定していなくても締められる」を有効にした期間を除く）。",
								tip: "締めた評価期間は、もう一度開始できません。確認画面の内容を読んでから押してください。",
								image: IMAGES.periodSwitch,
							},
							{
								who: "全員",
								title: "次の評価期間のシートを作る",
								body: "シートは自動では作られません。各自が「新規作成」から作り、前期のチャレンジ目標を引き継いで書き始めます。",
							},
						]}
					/>

					<h3>締めた後に誤りが見つかったら</h3>
					<div class="guide-split">
						<p>
							管理者が「遡及処理」で、理由を記録して項目ごとに直します（期間は締め済みのまま）。直した項目はシートの上部と
							PDF
							に「締め後修正」として、変更前後の内容・日時・理由とともに表示され、操作は監査ログに残ります。
						</p>
						<HelpScreenshot image={IMAGES.corrections} shot={shot} onOpen={openImage} />
					</div>
				</Chapter>

				<Chapter id="faq" lead="説明会のあとで迷いやすいところを、場面ごとにまとめました。">
					<For each={FAQ}>
						{(group) => (
							<div class="guide-faq">
								<h3>{group.title}</h3>
								<For each={group.items}>
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
							</div>
						)}
					</For>
				</Chapter>
			</article>

			<dialog
				id="help-image-viewer"
				ref={imageDialog}
				class="help-image-viewer"
				aria-labelledby="help-image-title"
				onClose={() => setSelectedImage(null)}
			>
				<Show when={selectedImage()}>
					{(image) => (
						<>
							<header>
								<h2 id="help-image-title">{image().caption}</h2>
								<button type="button" autofocus onClick={() => imageDialog?.close()}>
									<X size={18} aria-hidden="true" />
									閉じる
								</button>
							</header>
							<div class="help-image-viewer__body">
								<img
									src={shot(image().shot)}
									alt={image().caption}
									width={image().width}
									height={image().height}
								/>
							</div>
						</>
					)}
				</Show>
			</dialog>
		</div>
	);
};
export default HelpView;
