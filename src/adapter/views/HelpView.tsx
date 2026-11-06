import Bell from "lucide-solid/icons/bell";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Mail from "lucide-solid/icons/mail";
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
import {
	CarryOverDiagram,
	CorrectionDiagram,
	CycleDiagram,
	DivisionDiagram,
	FlowDiagram,
	GoalAnatomy,
	GoalReviewFork,
	NoticeDiagram,
	PeriodSwitchDiagram,
	RegistrationDiagram,
	RolesDiagram,
	ScoreDiagram,
	ScoringAnatomy,
	ScreenMapDiagram,
	SeasonDiagram,
	SecondPaths,
	StateTable,
	TermDiagram,
	VisibilityMatrix,
	WorkspaceLoop,
	WritableMatrix,
} from "./HelpDiagrams";
import { helpShot } from "./helpShots";
import "./styles/help.css";

/*
 * ヘルプ兼、導入説明会の資料。章をスライドに分け、1枚ごとに1つの図で要点を伝える。
 * 図に描いた事実は文で繰り返さず、文は図に無いことだけを書く(情報は落とさない)。
 * 状態・担当・通知・書ける時期・ランクの区切りは、ドメインの定義から図にする(HelpDiagrams / helpGuide)。
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
	result: page("evaluator/12-sheet-list", "部下の評価シートの PDF 出力"),
	periodSwitch: page("admin/07-period-switch", "評価期間を締める確認"),
	corrections: {
		shot: "evaluator/15-corrections",
		caption: "締め後修正の記録",
		width: 1216,
		height: 243,
	},
} satisfies Record<string, HelpImage>;

// 手順内は操作欄を中心に表示し、拡大時は元の画面全体を表示する。切り出しは画像自身の大きさに対する割合で動かすので、
// 枠の縦横比が切り出しと違っても(手順の写真は 16:10 にそろえる)左上がずれない。
const previewStyle = (image: HelpImage) => {
	const crop = image.preview;
	return crop
		? {
				"--shot-ratio": `${crop.width} / ${crop.height}`,
				"--help-image-width": `${(image.width / crop.width) * 100}%`,
				"--help-image-shift": `${(-crop.x / image.width) * 100}% ${(-crop.y / image.height) * 100}%`,
			}
		: { "--shot-ratio": `${image.width} / ${image.height}` };
};

type ShotSource = (name: string) => string | undefined;
type OpenImage = (image: HelpImage) => void;

const HelpScreenshot: Component<{ image: HelpImage; shot: ShotSource; onOpen: OpenImage }> = (
	props,
) => (
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
					<span class="guide-shot__zoom">
						<ZoomIn size={16} aria-hidden="true" />
						拡大
					</span>
				</button>
				<figcaption>{props.image.caption}</figcaption>
			</figure>
		)}
	</Show>
);

// ---------------------------------------------------------------- 章とスライド

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

const chapterOf = (id: ChapterId) => {
	const index = CHAPTERS.findIndex((chapter) => chapter.id === id);
	return { ...CHAPTERS[index], number: index + 1 };
};

/** 章。見出し(h2)は最初のスライドの肩に置く。 */
const Chapter: ParentComponent<{ id: ChapterId }> = (props) => (
	<section id={props.id} class="guide-chapter" aria-labelledby={`${props.id}-title`}>
		{props.children}
	</section>
);

/**
 * スライド1枚。肩に章、見出し、ひとこと、図。first: 章の最初の1枚(章の見出しを h2 として持つ)。
 * aside: 図の横に添える写真や補足。
 */
const Slide: ParentComponent<{
	chapter: ChapterId;
	title: string;
	lead?: string;
	first?: boolean;
	aside?: JSX.Element;
}> = (props) => {
	const chapter = chapterOf(props.chapter);
	return (
		<article class="slide" classList={{ "slide--aside": !!props.aside }}>
			<header class="slide__head">
				<Show
					when={props.first}
					fallback={
						<p class="slide__chapter" aria-hidden="true">
							<span>{chapter.number}</span>
							{chapter.title}
						</p>
					}
				>
					<h2 id={`${props.chapter}-title`} class="slide__chapter">
						<span aria-hidden="true">{chapter.number}</span>
						{chapter.title}
					</h2>
				</Show>
				<h3 class="slide__title">{props.title}</h3>
				<Show when={props.lead}>
					<p class="slide__lead">{props.lead}</p>
				</Show>
			</header>
			<div class="slide__body">{props.children}</div>
			<Show when={props.aside}>
				<div class="slide__aside">{props.aside}</div>
			</Show>
		</article>
	);
};

interface Step {
	title: string;
	body: JSX.Element;
	who?: string;
	tip?: string;
	image?: HelpImage;
}

/** 番号付きの手順を横に並べる。写真があれば上に置く。 */
const Steps: Component<{
	label: string;
	steps: Step[];
	start?: number;
	shot: ShotSource;
	onOpen: OpenImage;
}> = (props) => (
	<ol
		class="guide-steps"
		aria-label={props.label}
		style={{ "--guide-steps": Math.min(props.steps.length, 3) }}
	>
		<For each={props.steps}>
			{(step, index) => (
				<li>
					<Show when={step.image}>
						{(image) => <HelpScreenshot image={image()} shot={props.shot} onOpen={props.onOpen} />}
					</Show>
					<h4 class="guide-steps__title">
						<span class="guide-steps__number">{(props.start ?? 1) + index()}</span>
						<Show when={step.who}>
							<span class="guide-steps__who">{step.who}</span>
						</Show>
						{step.title}
					</h4>
					<p class="guide-steps__body">{step.body}</p>
					<Show when={step.tip}>
						<p class="guide-steps__tip">{step.tip}</p>
					</Show>
				</li>
			)}
		</For>
	</ol>
);

/** 図に添える短い補足。図で言い切れないことだけを書く。 */
const Notes: Component<{ items: JSX.Element[] }> = (props) => (
	<ul class="guide-notes">
		<For each={props.items}>{(item) => <li>{item}</li>}</For>
	</ul>
);

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
				"締め済みのシートは閲覧用です。評価者と管理者は、評価確定のシートを PDF 出力できます（本人は出力できません）。未確定のまま締める設定の期間では、未確定のシートも出力でき、点数・ランク・評価コメントは「***」で表示されます。",
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
				"社員マスタで未登録の社員の「招待コード」を押し、表示されたコードを本人に渡します。「招待コードを一括発行」では、発行済みの社員を除くか、含めて新しく発行するか選べます。除く場合も未発行・期限切れの社員には発行します。閉じたコードは再表示できません。再発行すると以前のコードは無効になります。",
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
				"等級と共通目標",
				"ユーザーメニューの「等級」で等級の追加・変更と、等級ごとの共通目標を選びます。「共通目標」で項目名・説明・重みを直します。評価シートは作成時の共通目標を持ち続けるので、直しても作成済みのシートは変わりません。直した内容を入れたいシートは作り直してもらいます。",
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
	const steps = { shot, onOpen: openImage };
	const screenshot = (image: HelpImage) => (
		<HelpScreenshot image={image} shot={shot} onOpen={openImage} />
	);

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
			{ rootMargin: "-40% 0px -55% 0px" },
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
						{(chapter, index) => (
							<li>
								<a
									class="guide-rail__link"
									href={`#${chapter.id}`}
									aria-current={current() === chapter.id ? "location" : undefined}
								>
									<span class="guide-rail__number" aria-hidden="true">
										{index() + 1}
									</span>
									{chapter.short}
								</a>
							</li>
						)}
					</For>
				</ol>
			</nav>

			<div class="guide-body">
				<header class="slide slide--cover">
					<h1 class="guide-cover__title">
						<span>評価のしくみと</span>
						<span class="guide-cover__second">使い方</span>
					</h1>
					<div class="guide-cover__side">
						<p class="guide-cover__lead">
							TYPA
							人事評価の導入説明。評価シートを書く人、評価する人、運用する人が、1期の流れを同じ図で確かめます。
						</p>
						<nav class="guide-toc" aria-label="目次">
							<ol>
								<For each={CHAPTERS}>
									{(chapter) => (
										<li>
											<a href={`#${chapter.id}`}>
												<span class="guide-toc__title">{chapter.title}</span>
												<span class="guide-toc__who">{chapter.who}</span>
											</a>
										</li>
									)}
								</For>
							</ol>
						</nav>
					</div>
				</header>

				<Chapter id="overview">
					<Slide
						chapter="overview"
						first
						title="期を評価期間に分け、1人1枚で評価する"
						lead="評価は「評価期間」ごとに、1人1枚の評価シートで進めます。"
					>
						<TermDiagram />
						<Notes
							items={[
								"通年なら1つ、四半期なら4つの評価期間に分かれます。上期と下期の点数を合わせて期の点数にすることはしません。",
								"共通評価の項目は、シートを作った時点の等級で決まります。",
							]}
						/>
					</Slide>
					<Slide chapter="overview" title="3人で1枚を回し、管理者が仕組みを整える">
						<RolesDiagram />
					</Slide>
					<Slide chapter="overview" title="1つの評価期間の流れ">
						<SeasonDiagram />
					</Slide>
				</Chapter>

				<Chapter id="start">
					<Slide chapter="start" first title="初めて使うときに、一度だけ登録する">
						<RegistrationDiagram />
						<Notes
							items={[
								"「認証コード」はメールで届くコード、「招待コード」は管理者から受け取るコードです。登録には両方が要ります。",
							]}
						/>
					</Slide>
					<Slide
						chapter="start"
						title="ログインは社員番号とパスワード"
						lead="メールアドレスではログインしません。画面の上部から、それぞれの画面へ移ります。"
					>
						<ScreenMapDiagram />
						<Notes
							items={[
								"共有PCでは、終わったら必ず右上の自分の名前から「ログアウト」してください。",
								"パスワードを忘れたときは、管理者に登録の取り消しと招待コードの再発行を頼み、新規登録をやり直します（評価シートは残ります）。",
							]}
						/>
					</Slide>
				</Chapter>

				<Chapter id="flow">
					<Slide
						chapter="flow"
						first
						title="6つの状態と、ボールを持つ人"
						lead="いつも誰か1人がボールを持っていて、その人が操作するまで次へは進みません。"
					>
						<FlowDiagram />
						<StateTable />
					</Slide>
					<Slide
						chapter="flow"
						title="いつ、誰が、何をできるか"
						lead="塗られたところだけができます。保存しただけでは次へ進まず、送信・依頼・確定を押して初めて次の人へ回ります。"
					>
						<WritableMatrix />
						<Notes
							items={[
								"一次評価を依頼した後は本人が、確定した後は評価者も直せません。押す前に見直してください。",
								"評価者がシートを読めるのは、本人が目標を送信してからです。",
							]}
						/>
					</Slide>
				</Chapter>

				<Chapter id="write">
					<Slide chapter="write" first title="1つの目標は3段でできている">
						<GoalAnatomy maxGoals={settings()?.maxChallengeGoals} />
					</Slide>
					<Slide chapter="write" title="期初：シートを作り、目標を送信する">
						<Steps
							label="期初の手順"
							{...steps}
							steps={[
								{
									title: "評価シートを作る",
									body: "「評価シート」で「新規作成」を押し、評価対象期間を選んで「評価シートを作成」。",
									tip: "作れるのは実施中の評価期間のシートだけ、1人1枚です。",
									image: IMAGES.create,
								},
								{
									title: "目標を書いて保存する",
									body: "「目標を編集」でチャレンジ目標と期中目標を書き、「目標を保存」。保存は目標のタブごとです。",
									tip: "目標を増やすときは「目標を追加」。空のタブが残っていると送信できません。",
									image: IMAGES.goal,
								},
								{
									title: "目標を送信する",
									body: "シート上部の「目標を送信する」を押し、確認画面でもう一度押します。",
									tip: "要修正で戻されたら、理由を読んで直し、もう一度送信します。",
									image: IMAGES.submit,
								},
							]}
						/>
					</Slide>
					<Slide chapter="write" title="期中〜期末：振り返って、評価を依頼する">
						<Steps
							label="期中から期末の手順"
							start={4}
							{...steps}
							steps={[
								{
									title: "達成状況を書く",
									body: "「達成状況を入力」で期中目標ごとに実績を書き、「達成状況を保存」。目標の文言と件数は、もう変えられません。",
								},
								{
									title: "一次評価を依頼する",
									body: "書き終えたら、シート上部の「一次評価を依頼する」。以後は本人は直せません。",
									image: IMAGES.request,
								},
							]}
						/>
					</Slide>
					<Slide
						chapter="write"
						title="前期のチャレンジ目標を引き継ぐ"
						lead="下書きの間は、前の評価期間の目標が並びます。続けたい目標だけ、目標ごとに選びます。"
						aside={screenshot(IMAGES.previous)}
					>
						<CarryOverDiagram />
						<Notes
							items={[
								"前期と同じ番号の目標に入ります。その番号を今期の別の目標が使っているときは、空いている目標に入ります。",
								"引き継ぐのはチャレンジ目標の文言だけ。期中目標は毎期書き直します（前期の期中目標と達成状況は読めます）。",
								"書き換えて保存するまでは「据え置き」のまま。「前期のまま据え置く」で前期の文言に戻せます。表示は評価者にも見えます。",
								"引き継いだ目標を削除すると、また選べます。",
							]}
						/>
					</Slide>
				</Chapter>

				<Chapter id="review">
					<Slide
						chapter="review"
						first
						title="あなたの番のシートを、順に開く"
						aside={screenshot(IMAGES.workspace)}
					>
						<WorkspaceLoop />
						<Notes
							items={[
								"そろえるための道具：「比較」に最大6名をチェックして横に並べる、「等級ごとに区切る」、並び順「一次・二次の差が大きい順」。",
							]}
						/>
					</Slide>
					<Slide
						chapter="review"
						title="期初：送信された目標を確認する"
						aside={screenshot(IMAGES.goalReview)}
					>
						<GoalReviewFork />
					</Slide>
					<Slide chapter="review" title="期末：採点・総評を書いて確定する">
						<ScoringAnatomy />
						<Steps
							label="一次評価の手順"
							{...steps}
							steps={[
								{
									title: "チャレンジ目標",
									body: "達成状況まで読み、「評価を入力」→ 1〜4 →「評価を保存」。",
									image: IMAGES.score,
								},
								{
									title: "共通評価",
									body: "項目ごとに 1〜4、必要ならコメント。「評価を保存」は表の上と下にあります。",
									image: IMAGES.common,
								},
								{
									title: "総評と確定",
									body: "「総評を保存」の後、右下の「一次評価を確定する」。確認画面にランクと点数が出て、二次評価者に依頼が届きます。",
									tip: "点数・コメント・総評は欄ごとに保存します。保存しないまま別の部下を開くと確認が出ます。",
									image: IMAGES.confirm,
								},
							]}
						/>
					</Slide>
					<Slide
						chapter="review"
						title="一次評価の後：二次評価と、二次評価者「なし」"
						aside={screenshot(IMAGES.second)}
					>
						<SecondPaths />
					</Slide>
				</Chapter>

				<Chapter id="score">
					<Slide
						chapter="score"
						first
						title="評価点は100点満点、ランクは自動で決まる"
						lead="点数は 1〜4 の4段階で付けます。評価点とランクは手で変えられません。"
					>
						<ScoreDiagram
							allocation={allocation()}
							source={
								settings() ? "いまの配点（管理者が設定）" : "配点の例（実際の配点は管理者が設定）"
							}
						/>
					</Slide>
					<Slide
						chapter="score"
						title="評価の内容は、本人には公開しない"
						lead="評価確定の後も、本人には点数・コメント・総評・ランク・評価点を見せません。最終評価を見られるのは、最終評価者と管理者だけです。"
						aside={screenshot(IMAGES.result)}
					>
						<VisibilityMatrix />
						<Notes
							items={[
								"PDF は、評価者と管理者が「評価シート一覧」の「部下の評価シート」から出します。見られる範囲だけが載り、一次評価者の PDF では二次評価と最終評価を「***」で伏せます。",
								"評価確定になる前は「確定後に PDF 出力」と表示されます。確定前のランクは、入力中の点数から計算した見込みとして薄く表示されます。",
							]}
						/>
					</Slide>
				</Chapter>

				<Chapter id="notice">
					<Slide
						chapter="notice"
						first
						title="受け渡しのたびに、受け取る人へ届く"
						lead="届いた依頼を選ぶと、そのシートが開きます。"
					>
						<NoticeDiagram />
						<p class="guide-caption">評価確定（最後の確定）は、誰にも通知しません。</p>
						<dl class="guide-modes">
							<div>
								<dt>
									<Bell size={18} aria-hidden="true" />
									アプリ内通知（標準）
								</dt>
								<dd>
									画面上部のベルに未読の数が出ます。状態が変わると同時に届き、次の段階へ進んだ依頼は自動で既読になります。要修正で戻すと、届いていた依頼は取り下げられます。
								</dd>
							</div>
							<div>
								<dt>
									<Mail size={18} aria-hidden="true" />
									メール
								</dt>
								<dd>
									管理者がメールを選んだときは、登録時に確かめたアドレスに届きます。送信・依頼・確定の確認画面で、送るかどうかを選べます。届かないときはシート上部の「通知を再送」を使えます。
								</dd>
							</div>
						</dl>
					</Slide>
				</Chapter>

				<Chapter id="close">
					<Slide
						chapter="close"
						first
						title="締めると次は準備中、開始して実施中へ"
						aside={screenshot(IMAGES.periodSwitch)}
						lead="締めても、次の評価期間は自動では始まりません。状態は 未開始 → 準備中 → 実施中 → 締め済み と進み、戻りません。"
					>
						<PeriodSwitchDiagram />
						<Notes
							items={[
								"シートの作成・記入・評価・確定ができるのは「実施中」の評価期間だけです。「未開始」と「準備中」の間は、誰もシートを作れません。",
								"準備中は、前の評価期間を締めてから次を開始するまでの間です。管理者は、この間に等級の変更などを済ませます。",
								"締めた評価期間は閲覧と PDF 出力だけになり、まだシートを作っていない人も作れなくなります。もう一度開始することはできません。",
								"次の評価期間のシートは自動では作られません。各自が「新規作成」から作り、前期のチャレンジ目標を引き継いで書き始めます。",
							]}
						/>
					</Slide>
					<Slide
						chapter="close"
						title="期の分け方"
						lead="分けた評価期間は、それぞれ独立して評価します。"
					>
						<DivisionDiagram />
					</Slide>
					<Slide
						chapter="close"
						title="1つの評価期間の、始まりから次の開始まで"
						lead="7つの手順を、評価期間ごとにくり返します。"
					>
						<CycleDiagram
							label="1つの評価期間の手順"
							center="評価期間ごとにくり返す"
							steps={[
								{
									who: "本人",
									title: "シートを作り、目標を提案する",
									body: "チャレンジ目標と期中目標を書いて「目標を送信する」。前期のチャレンジ目標も引き継げます。",
								},
								{
									who: "一次評価者",
									title: "目標を承認、または差し戻す",
									body: "部下から送信された目標を「目標を確定する」で承認するか、理由を添えて下書きに差し戻します。",
								},
								{
									who: "本人",
									title: "達成状況を入力し、一次評価を依頼する",
									body: "「一次評価を依頼する」で送信すると、一次評価者に自動で通知されます。",
								},
								{
									who: "評価者",
									title: "評価して確定する",
									body: "一次評価、二次評価者がいれば二次評価で最終確定。ランクは得点率から自動で決まり、シートは終わります。",
								},
								{
									who: "管理者",
									title: "評価期間を締める",
									body: "未確定のシートが残っていると締められません。締めの時期に残っていれば、二次評価待ちのような状態でも、所管の部門長に連絡して催促します。",
								},
								{
									who: "管理者",
									title: "等級の変更を反映する",
									body: "準備中の間に、被評価者から等級変更の依頼があれば、社員マスタで変更します。等級はシートを作った時点で固定されます。",
								},
								{
									who: "管理者",
									title: "次の評価期間を開始する",
									body: "準備中の評価期間を「この期間を開始する」で開始すると、1に戻ります。",
								},
							]}
						/>
					</Slide>
					<Slide
						chapter="close"
						title="締めた後に誤りが見つかったら"
						aside={screenshot(IMAGES.corrections)}
					>
						<CorrectionDiagram />
						<Notes
							items={[
								"「評価が確定していなくても締められる」期間のシートは、確定していなくても PDF に出せます。点数・ランク・評価者のコメントは「***」で伏せます。",
							]}
						/>
					</Slide>
				</Chapter>

				<Chapter id="faq">
					<Slide
						chapter="faq"
						first
						title="よくある質問"
						lead="説明会のあとで迷いやすいところを、場面ごとにまとめました。"
					>
						<div class="guide-faq">
							<For each={FAQ}>
								{(group) => (
									<section class="guide-faq__group" aria-label={group.title}>
										<h4>{group.title}</h4>
										<For each={group.items}>
											{([question, answer]) => (
												<details>
													<summary>
														{question}
														<ChevronDown class="guide-faq__chevron" size={18} aria-hidden="true" />
													</summary>
													<p>{answer}</p>
												</details>
											)}
										</For>
									</section>
								)}
							</For>
						</div>
					</Slide>
				</Chapter>
			</div>

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
