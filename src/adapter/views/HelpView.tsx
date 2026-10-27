import { A } from "@solidjs/router";
import ArrowRight from "lucide-solid/icons/arrow-right";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ClipboardCheck from "lucide-solid/icons/clipboard-check";
import PencilLine from "lucide-solid/icons/pencil-line";
import X from "lucide-solid/icons/x";
import ZoomIn from "lucide-solid/icons/zoom-in";
import { type Component, createSignal, For, Show } from "solid-js";
import { helpShot } from "./helpShots";
import "./styles/help.css";

interface HelpImage {
	/** マニュアルの画面写真の名前。写真が無ければ表示しない(helpShots)。 */
	shot: string;
	caption: string;
	width: number;
	height: number;
	preview?: { x: number; y: number; width: number; height: number };
}

const IMAGES = {
	create: {
		shot: "user/05-new-sheet",
		caption: "評価期間の選択・シート作成",
		width: 1280,
		height: 800,
		preview: { x: 24, y: 156, width: 536, height: 278 },
	},
	goal: { shot: "user/07-goal", caption: "目標の入力と保存", width: 1216, height: 926 },
	submit: {
		shot: "user/08-submit",
		caption: "目標送信の確認",
		width: 1280,
		height: 800,
		preview: { x: 404, y: 251, width: 472, height: 298 },
	},
	review: { shot: "evaluator/01-workspace", caption: "評価対象の一覧", width: 1280, height: 800 },
	score: { shot: "evaluator/03-goal-score", caption: "目標の採点", width: 1280, height: 800 },
	confirm: {
		shot: "evaluator/06-confirm-first",
		caption: "一次評価の確定",
		width: 1280,
		height: 800,
	},
	registration: {
		shot: "user/03-register-code",
		caption: "新規登録の入力項目",
		width: 1280,
		height: 800,
	},
	result: {
		shot: "user/10-sheet-list-final",
		caption: "評価結果のPDF出力",
		width: 1280,
		height: 800,
	},
	previous: {
		shot: "user/15-previous-goals",
		caption: "前期のチャレンジ目標",
		width: 1216,
		height: 274,
	},
	corrections: {
		shot: "user/16-corrections",
		caption: "締め後修正の記録",
		width: 1216,
		height: 243,
	},
} satisfies Record<string, HelpImage>;

const TOPIC_IMAGES: Record<string, HelpImage | undefined> = {
	新規登録: IMAGES.registration,
	前期のチャレンジ目標: IMAGES.previous,
	評価結果とPDF出力: IMAGES.result,
	締め後修正の確認: IMAGES.corrections,
};

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
			<figure class="help-guide__screenshot">
				<button
					type="button"
					class="help-guide__image-button"
					aria-label={`${props.image.caption}を拡大`}
					aria-haspopup="dialog"
					aria-controls="help-image-viewer"
					onClick={() => props.onOpen(props.image)}
				>
					<div
						class="help-guide__preview"
						classList={{ "help-guide__preview--cropped": !!props.image.preview }}
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

const GUIDES = {
	self: [
		{
			title: "評価シートを開く",
			description:
				"「評価シート一覧」で評価期間を選び、自分のシートを開きます。未作成の場合は「新規作成」から評価期間を選び、「評価シートを作成」を押します。",
			image: IMAGES.create,
			tip: "評価シートは、実施中の評価期間に1人1枚作成できます。",
		},
		{
			title: "目標を記入・保存する",
			description:
				"「目標を編集」を押し、チャレンジ目標と、今期の計画として期中目標を1件ずつ入力して「目標を保存」を押します。前期に書いた目標は、チャレンジ目標の「前期」タブで見られます。達成状況は一次評価を依頼するまで、いつでも書き直せます。",
			image: IMAGES.goal,
			tip: "保存はチャレンジ目標ごとに行います。期中目標は各チャレンジ目標に0〜4件。0件の場合はチャレンジ目標に達成状況を記入します。",
		},
		{
			title: "目標を送信する",
			description:
				"目標を保存し、シート上部の「目標を送信する」を押します。確認画面で再度「目標を送信する」を押します（通知の方法がメールのときは、通知メールを送るかも選べます）。",
			image: IMAGES.submit,
			tip: "送信済みの目標は一次評価者が確認し、要修正として下書きに戻すか、目標を確定します。まだ採点は始まりません。",
		},
	],
	reviewer: [
		{
			title: "評価するシートを開く",
			description:
				"「部下の評価」を開き、評価期間を選びます。「目標を確認する」「一次評価する」または「二次評価する」で一覧を絞り込み、対象の社員を押します。",
			image: IMAGES.review,
			tip: "送信済みは「目標を確定する」か「要修正として下書きに戻す」を選びます。本人が達成状況を入力して一次評価を依頼するまで採点できません。",
		},
		{
			title: "点数・コメントを保存する",
			description:
				"チャレンジ目標と共通評価の「評価を入力」を押し、各項目を1〜4で採点して「評価を保存」を押します。総評は「総評を保存」で保存します。",
			image: IMAGES.score,
			tip: "保存は目標・共通評価・総評ごとに行います。二次評価者は、一次評価の確定後に採点できます。",
		},
		{
			title: "評価を確定する",
			description:
				"すべての採点を保存し、右下の「一次評価を確定する」または「二次評価を確定する」を押します。確認画面で内容を確認して確定します。",
			image: IMAGES.confirm,
			tip: "二次評価者が「なし」の場合は、一次評価者が「評価を確定する」を押すと最終評価済みになります。",
		},
	],
};
const QUESTIONS = {
	self: [
		[
			"送信した内容の修正",
			"チャレンジ目標・期中目標の修正が必要な場合は、送信済みの段階で一次評価者に要修正として下書きへ戻してもらいます。達成状況は、目標の確認中も目標確定後も「達成状況を入力」から書き直せます。「一次評価を依頼する」を押して一次評価待ちになると、本人による修正はできません。",
		],
		[
			"前期のチャレンジ目標",
			"チャレンジ目標の「前期」タブで、前期に書いた目標を見返せます（初めは「当期」が開いています）。続けたい目標があれば、下書きの間は「据え置く」（文言をそのまま引き継ぐ）か「見直して更新」（引き継いでから書き直す）で今期に引き継げます。引き継ぐかどうかは自由です。前期と同じ番号の目標に入ります（その番号を今期の別の目標が使っているときは、空いている目標へ）。期中目標と達成状況は引き継がず、今期の計画として書き直します。引き継いだ目標を削除すると、また選べます。",
		],
		[
			"評価結果とPDF出力",
			"最終評価済みになると、シートに目標ごとの一次評価の点数が表示されます。共通評価・総評・評価点・評価ランクは、「評価シート一覧」の「PDF出力」で確認します。",
		],
		[
			"締め済みの評価期間",
			"締め済みのシートは閲覧用です。最終評価済みのシートはPDF出力できます。未確定のまま締める設定の期間では、未確定のシートも出力でき、点数・ランク・評価コメントは「***」で表示されます。",
		],
		[
			"締め後修正の確認",
			"シート上部の「締め後修正があります」に、管理者が修正した項目・変更前後の内容・日時・理由が表示されます。PDFにも修正の記録が載ります。表示される項目は閲覧権限によって異なります。",
		],
	],
	reviewer: [
		[
			"評価を入力できる時期",
			"一次評価は本人が一次評価を依頼した後から、二次評価は一次評価の確定後から入力できます。目標は送信された時点から読めます。実施中の期間の下書きは評価者に表示されません。締め済みの期間は閲覧のみです。",
		],
		[
			"確定に必要な入力",
			"チャレンジ目標と共通評価の全項目に1〜4の点数が必要です。「自分の評価: あと〇件」から未評価の項目を確認できます。入力中の点数・コメント・総評は、確定前に保存してください。",
		],
		[
			"評価点とランク",
			"チャレンジ目標と共通評価の点数・配点から、100点満点の評価点とランクを自動計算します。確定前のランクは見込みです。",
		],
		[
			"評価結果のPDF出力",
			"「評価シート一覧」の「部下の評価シート」で「PDF出力」を押します。最終評価済みのPDFで、点数・総評・評価点・ランクを確認できます。一次評価者が二次評価の点数を確認できるのは、最終評価の確定後です。",
		],
		[
			"確定後の訂正",
			"確定した段階の評価は、本人・評価者からは変更できません。訂正は管理者に依頼してください。締め済みの期間は、管理者が「遡及処理」で理由を記録して修正します。",
		],
	],
};
const COMMON_QUESTIONS = [
	{
		title: "登録・ログイン",
		items: [
			[
				"新規登録",
				"管理者から社員番号と招待コードを受け取ります。「新規登録」で会社の指定ドメインのメールアドレスに認証コードを送り、認証コード・社員番号・招待コード・パスワードを入力します。パスワードは6文字以上で、大文字・小文字・数字を含めます。共有メールも使用できます。",
			],
			[
				"認証コードと招待コード",
				"認証コードはメールで受信します。招待コードは管理者が社員ごとに発行し、有効期限は7日間、使用は1回限りです。紛失・期限切れの場合は再発行を依頼してください。",
			],
			[
				"ログイン・ログアウト",
				"ログインには社員番号とパスワードを使います。終了時は、右上のユーザーメニューから「ログアウト」を押します。共有PCでは必ずログアウトしてください。",
			],
			[
				"パスワードを忘れた場合",
				"管理者に登録の取り消しと招待コードの発行を依頼し、新規登録をやり直します。評価シートは引き継がれます。",
			],
			[
				"利用停止の表示",
				"利用の再開を管理者に依頼してください。パスワードの変更や新規登録では解除できません。",
			],
		],
	},
	{
		title: "通知",
		items: [
			[
				"評価の依頼の知らせ方",
				"目標の送信・一次評価の依頼は一次評価者へ、目標の確定・要修正は本人へ、一次評価の確定は二次評価者へ知らせます。最終評価の確定では知らせません。知らせ方は管理者が設定で選びます。アプリ内通知（既定）では画面上部のベルに届き、メールでは新規登録のときに確認したメールアドレスへ送ります。",
			],
			[
				"ベルの未読",
				"ベルの数字は、未読の依頼の数です。依頼を選ぶとシートが開き、既読になります。評価が次の段階に進んだ依頼は自動で既読になり、一次評価者が要修正として戻した依頼は取り下げられます。",
			],
			[
				"メールの送信失敗と再送",
				"通知の方法がメールのときの案内です。送信に失敗しても、状態の変更は完了しています。送信済み・一次評価待ちでは本人、目標確定・二次評価待ちでは一次評価者が、シート上部の「通知を再送」を使えます。待機時間や回数制限が表示された場合は、画面の案内に従ってください。",
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
			[
				"送信済みのメールが届かない場合",
				"迷惑メールフォルダーと共有メールの受信箱を確認してください。送信済みの通知は再送されません。見つからない場合は、管理者に宛先と配送状況の確認を依頼してください。",
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
				"評価期間の開始",
				"「設定」で次の評価期間の「この期間を開始する」を押します。実施中の期間は同時に締められます。未確定のシートが残っている場合は、全件を確定するか、その期間の「評価が確定していなくても締められる」を有効にします。",
			],
			[
				"締め済みシートの訂正",
				"ユーザーメニューの「遡及処理」で、締め済みの評価期間とシートを選びます。修正内容と理由を入力して記録します。期間は締め済みのままです。",
			],
		],
	},
	{
		title: "アプリの更新",
		items: [
			[
				"アプリの更新",
				"入力を保存して「今すぐ更新」を押します。更新が済むと、アプリが自動で開き直します（PCは再起動しません）。作業を続ける場合は「あとで」を選びます。未保存の入力がある場合は、インストール前に確認画面が表示されます。",
			],
		],
	},
];
/** shot: 画面写真の探し方。テストでは撮っていない写真の代わりを渡す。 */
const HelpView: Component<{ shot?: ShotSource }> = (props) => {
	const shot: ShotSource = (name) => (props.shot ?? helpShot)(name);
	const [audience, setAudience] = createSignal<"self" | "reviewer">("self");
	const [selectedImage, setSelectedImage] = createSignal<HelpImage | null>(null);
	let imageDialog: HTMLDialogElement | undefined;
	const openImage = (image: HelpImage) => {
		setSelectedImage(image);
		imageDialog?.showModal();
	};
	const isSelf = () => audience() === "self";
	return (
		<div class="help-guide">
			<header class="help-guide__hero">
				<h1>ヘルプ</h1>
				<p>評価シートの記入・送信、評価、登録・管理の操作手順です。</p>
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
					<h2 id="help-guide-title">{isSelf() ? "記入・送信の手順" : "評価・確定の手順"}</h2>
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
								<p class="help-guide__tip">{step.tip}</p>
								<HelpScreenshot image={step.image} shot={shot} onOpen={openImage} />
							</li>
						)}
					</For>
				</ol>
			</section>
			<section class="help-guide__faq" aria-labelledby="help-faq-title">
				<h2 id="help-faq-title">操作の確認</h2>
				<h3>{isSelf() ? "シートの記入・送信" : "評価・確定"}</h3>
				<For each={QUESTIONS[audience()]}>
					{([question, answer]) => (
						<details>
							<summary>
								{question}
								<ChevronDown size={18} aria-hidden="true" />
							</summary>
							<p>{answer}</p>
							<Show when={TOPIC_IMAGES[question]}>
								{(image) => <HelpScreenshot image={image()} shot={shot} onOpen={openImage} />}
							</Show>
						</details>
					)}
				</For>
				<For each={COMMON_QUESTIONS}>
					{(group) => (
						<div class="help-guide__faq-group">
							<h3>{group.title}</h3>
							<For each={group.items}>
								{([question, answer]) => (
									<details>
										<summary>
											{question}
											<ChevronDown size={18} aria-hidden="true" />
										</summary>
										<p>{answer}</p>
										<Show when={TOPIC_IMAGES[question]}>
											{(image) => <HelpScreenshot image={image()} shot={shot} onOpen={openImage} />}
										</Show>
									</details>
								)}
							</For>
						</div>
					)}
				</For>
			</section>
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
