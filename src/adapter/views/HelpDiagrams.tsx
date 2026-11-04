import ArrowDown from "lucide-solid/icons/arrow-down";
import ArrowRight from "lucide-solid/icons/arrow-right";
import Bell from "lucide-solid/icons/bell";
import BellOff from "lucide-solid/icons/bell-off";
import FileText from "lucide-solid/icons/file-text";
import KeyRound from "lucide-solid/icons/key-round";
import Lock from "lucide-solid/icons/lock";
import Mail from "lucide-solid/icons/mail";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import Ticket from "lucide-solid/icons/ticket";
import Undo2 from "lucide-solid/icons/undo-2";
import UserRound from "lucide-solid/icons/user-round";
import { type Component, For, type JSX, Show } from "solid-js";
import { EvaluationStatus, type SheetActor } from "../../domain/valueObjects/EvaluationStatus";
import { GoalReturnReason } from "../../domain/valueObjects/GoalReturnReason";
import { PeriodDivision } from "../../domain/valueObjects/PeriodDivision";
import { PeriodState } from "../../domain/valueObjects/PeriodState";
import {
	ACTOR_LABEL,
	nextStep,
	notices,
	rankBands,
	SCORE_EXAMPLE,
	STATE_GUIDE,
	scoreExample,
	WRITABLE_ROWS,
} from "../viewmodels/helpGuide";

/*
 * ヘルプの図。どの図も、それだけで要点が伝わるようにする(説明の文は図に無いことだけを書く)。
 * 担当の色分けは全図で同じ: 本人は藍の塗り、評価者は面、管理者は点線の枠。朱は評価確定の印だけ。
 */

const Arrow: Component<{ down?: boolean }> = (props) => (
	<span class="dg-arrow" aria-hidden="true">
		{props.down ? <ArrowDown size={20} /> : <ArrowRight size={20} />}
	</span>
);

type Party = SheetActor | "admin";
const PARTY_LABEL: Record<Party, string> = { ...ACTOR_LABEL, admin: "管理者" };

/** 担当の札。人の名前と、主に使う画面。 */
const Who: Component<{ party: Party; screen?: string; children?: JSX.Element }> = (props) => (
	<div class={`dg-who dg-who--${props.party}`}>
		<p class="dg-who__name">
			<UserRound size={18} aria-hidden="true" />
			{PARTY_LABEL[props.party]}
		</p>
		<Show when={props.screen}>
			<p class="dg-who__screen">{props.screen}</p>
		</Show>
		{props.children}
	</div>
);

// ---------------------------------------------------------------- 1. しくみ

/** 期は評価期間に分かれ、評価期間ごとに1人1枚のシートで評価が完結する。 */
export const TermDiagram: Component = () => {
	const division = PeriodDivision.HALF;
	return (
		<div class="dg-term">
			<p class="dg-term__term">
				26期<span>（例：{division.label}）</span>
			</p>
			<ol class="dg-term__parts" aria-label="評価期間">
				<For each={Array.from({ length: division.parts }, (_, index) => index + 1)}>
					{(part) => (
						<li>
							<p class="dg-term__name">{division.partLabel(part)}</p>
							<ul class="dg-term__sheets" aria-label="評価シート">
								<For each={[0, 1, 2, 3, 4]}>
									{(index) => (
										<li classList={{ "dg-term__sheet--you": index === 0 }}>
											<FileText size={26} aria-hidden="true" />
											<span class="visually-hidden">{index === 0 ? "あなたの1枚" : "1人1枚"}</span>
										</li>
									)}
								</For>
							</ul>
							<p class="dg-term__note">1人1枚。この期間の中で評価が完結</p>
						</li>
					)}
				</For>
			</ol>
		</div>
	);
};

/** 3人で1枚を回し、管理者は外から仕組みを整える。 */
export const RolesDiagram: Component = () => (
	<div class="dg-roles">
		<Who party="admin" screen="社員マスタ・設定">
			<ul class="dg-list">
				<li>誰が誰を評価するかを決める</li>
				<li>評価期間を開始し、締める</li>
				<li>締めた後の誤りを直す</li>
			</ul>
		</Who>
		<p class="dg-roles__hand" aria-hidden="true">
			評価者と等級を設定
		</p>
		<ol class="dg-roles__relay" aria-label="評価シートを回す順">
			<li>
				<Who party="subject" screen="評価シート">
					<ul class="dg-list">
						<li>目標と達成状況を書く</li>
						<li>送信・依頼で次へ回す</li>
					</ul>
				</Who>
			</li>
			<li aria-hidden="true">
				<Arrow />
			</li>
			<li>
				<Who party="primary" screen="部下の評価">
					<ul class="dg-list">
						<li>期初に目標を確認して確定</li>
						<li>期末に採点・総評して確定</li>
					</ul>
				</Who>
			</li>
			<li aria-hidden="true">
				<Arrow />
			</li>
			<li>
				<Who party="secondary" screen="部下の評価">
					<ul class="dg-list">
						<li>一次評価を見て採点し直す</li>
						<li>最終評価を確定</li>
					</ul>
				</Who>
			</li>
		</ol>
		<p class="dg-roles__bypass">
			二次評価者が「なし」の社員は、一次評価がそのまま最終評価になります
		</p>
	</div>
);

const SEASONS = ["期初", "期中", "期末", "締め"] as const;
type Season = (typeof SEASONS)[number];

/** 1つの評価期間で、時期ごとに誰が何をするか。 */
export const SeasonDiagram: Component = () => {
	const lanes: { party: Party; label: string; tasks: Partial<Record<Season, string>> }[] = [
		{
			party: "subject",
			label: "本人",
			tasks: {
				期初: "シートを作り、目標を提案（送信）",
				期中: "達成状況を書き足す",
				期末: "達成状況を入力し、一次評価を依頼（一次評価者へ自動で通知）",
			},
		},
		{
			party: "primary",
			label: "評価者",
			tasks: {
				期初: "一次評価者が目標を承認、または差し戻す",
				期末: "一次評価 → 二次評価で最終確定。ランクは自動",
			},
		},
		{
			party: "admin",
			label: "管理者",
			tasks: {
				期中: "新しい社員を仮登録・招待",
				期末: "未確定のシートを、所管の部門長に催促",
				締め: "締める → 準備中に等級の変更を反映 → 次の評価期間を開始",
			},
		},
	];
	return (
		<div class="dg-table-wrap dg-table-wrap--plain">
			<table class="dg-season">
				<caption class="visually-hidden">1つの評価期間の流れ</caption>
				<thead>
					<tr>
						<td />
						<For each={SEASONS}>{(season) => <th scope="col">{season}</th>}</For>
					</tr>
				</thead>
				<tbody>
					<For each={lanes}>
						{(lane) => (
							<tr class={`dg-season__lane dg-season__lane--${lane.party}`}>
								<th scope="row">{lane.label}</th>
								<For each={SEASONS}>
									{(season) => (
										<td>
											<Show when={lane.tasks[season]}>
												{(task) => <span class="dg-season__task">{task()}</span>}
											</Show>
										</td>
									)}
								</For>
							</tr>
						)}
					</For>
				</tbody>
			</table>
		</div>
	);
};

// ---------------------------------------------------------------- 2. 登録

/** 2つの鍵(招待コードと認証コード)が登録画面で合わさる。 */
export const RegistrationDiagram: Component = () => (
	<div class="dg-register">
		<ol class="dg-register__sources" aria-label="登録に要るもの">
			<li>
				<Who party="admin">
					<p class="dg-key">
						<Ticket size={18} aria-hidden="true" />
						社員番号と招待コードを渡す
					</p>
					<p class="dg-small">招待コードは発行から7日間、1回だけ使えます</p>
				</Who>
			</li>
			<li>
				<div class="dg-mailbox">
					<p class="dg-key">
						<Mail size={18} aria-hidden="true" />
						認証コードが届く
					</p>
					<p class="dg-small">
						「新規登録」でメールアドレスを入れ「認証コードを受け取る」。会社の指定ドメインのアドレス（共有メールも可）
					</p>
				</div>
			</li>
		</ol>
		<Arrow />
		<figure class="dg-form" aria-label="登録画面に入れるもの">
			<p class="dg-form__title">新規登録</p>
			<ul>
				<li>
					<span>認証コード</span>メールで届いたもの
				</li>
				<li>
					<span>社員番号</span>管理者から
				</li>
				<li>
					<span>招待コード</span>管理者から
				</li>
				<li>
					<span>パスワード</span>6文字以上・英大文字・小文字・数字
				</li>
			</ul>
			<p class="dg-form__button">登録する</p>
		</figure>
		<Arrow />
		<div class="dg-register__done">
			<p class="dg-key">
				<KeyRound size={18} aria-hidden="true" />
				社員番号を控えて「覚えました」
			</p>
			<p class="dg-small">評価シート一覧が開きます。次からは社員番号とパスワードでログイン</p>
		</div>
	</div>
);

/** 画面上部の帯と、それぞれの中身。 */
export const ScreenMapDiagram: Component = () => {
	const items = [
		["評価シート", "自分のシートの作成・閲覧、評価期間の切り替え、PDF 出力"],
		["部下の評価", "評価者を務める人だけに表示"],
		["社員マスタ", "自分の等級・一次評価者・二次評価者の確認"],
		["ベル", "あなたの番になった評価の依頼"],
		["自分の名前", "明るさ・ヘルプ・ログアウト（管理者は設定・遡及処理なども）"],
	] as const;
	return (
		<div class="dg-screen">
			<ol class="dg-screen__bar" aria-label="画面上部">
				<li class="dg-screen__logo" aria-hidden="true">
					TYPA
				</li>
				<For each={items}>
					{([name, detail]) => (
						<li>
							<p class="dg-screen__item">
								<Show when={name === "ベル"} fallback={name}>
									<Bell size={16} aria-hidden="true" />
									ベル
								</Show>
							</p>
							<p class="dg-screen__detail">{detail}</p>
						</li>
					)}
				</For>
			</ol>
		</div>
	);
};

// ---------------------------------------------------------------- 3. シートの流れ

const LANES: readonly SheetActor[] = ["subject", "primary", "secondary"];
const FLOW = { width: 1040, label: 116, column: 154, card: 118, cardHeight: 56, lane: 104 };
const cardX = (index: number) => FLOW.label + index * FLOW.column + (FLOW.column - FLOW.card) / 2;
const centerX = (index: number) => cardX(index) + FLOW.card / 2;
const laneY = (actor: SheetActor) => LANES.indexOf(actor) * FLOW.lane + FLOW.lane / 2;
const laneOf = (status: EvaluationStatus) => laneY(status.holder() ?? status.movedBy());

/** 担当ごとの段に状態の札を置き、ボールが行き来する様子を描く。評価確定は朱の印。 */
export const FlowDiagram: Component = () => {
	const statuses = EvaluationStatus.ALL;
	const last = statuses.length - 1;
	const height = LANES.length * FLOW.lane;
	const half = FLOW.cardHeight / 2;
	const seal = { x: centerX(last), y: height / 2, r: 58 };
	const sealEdge = (y: number) => seal.x - Math.sqrt(seal.r ** 2 - (y - seal.y) ** 2) - 4;
	const draft = EvaluationStatus.DRAFT.order();
	const sent = EvaluationStatus.GOALS_SUBMITTED.order();
	const requested = EvaluationStatus.SUBMITTED.order();
	const returnY = laneOf(EvaluationStatus.GOALS_SUBMITTED) + 14;
	const skipY = laneOf(EvaluationStatus.SUBMITTED) - 14;
	const arrow = (index: number) => {
		const x = cardX(index) + FLOW.card;
		const middle = x + (FLOW.column - FLOW.card) / 2;
		const y1 = laneOf(statuses[index]);
		if (index + 1 === last) {
			// 最後は印の下から入る
			return {
				d: `M${x} ${y1}H${seal.x}V${seal.y + seal.r + 4}`,
				badge: { x: (x + seal.x) / 2, y: y1 },
			};
		}
		const y2 = laneOf(statuses[index + 1]);
		return {
			d: `M${x} ${y1}H${middle}V${y2}H${cardX(index + 1) - 3}`,
			badge: { x: middle, y: (y1 + y2) / 2 },
		};
	};
	return (
		<div class="dg-flow">
			<svg
				viewBox={`0 0 ${FLOW.width} ${height}`}
				role="img"
				aria-labelledby="dg-flow-title"
				aria-describedby="dg-flow-desc"
			>
				<title id="dg-flow-title">評価シートの状態と、ボールを持つ人</title>
				<desc id="dg-flow-desc">
					本人・一次評価者・二次評価者の段に状態を並べ、番号の順にシートが受け渡されます。下の表と同じ内容です。
				</desc>
				<defs>
					<marker
						id="dg-arrowhead"
						viewBox="0 0 10 10"
						refX="8"
						refY="5"
						markerWidth="7"
						markerHeight="7"
						orient="auto-start-reverse"
					>
						<path d="M0 0L10 5L0 10z" class="dg-flow__head" />
					</marker>
				</defs>
				<For each={LANES}>
					{(actor, index) => (
						<g class="dg-flow__lane" classList={{ "dg-flow__lane--alt": index() % 2 === 1 }}>
							<rect x="0" y={index() * FLOW.lane} width={FLOW.width} height={FLOW.lane} />
							<text x="20" y={laneY(actor) + 5}>
								{ACTOR_LABEL[actor]}
							</text>
						</g>
					)}
				</For>
				<g class="dg-flow__arrows" marker-end="url(#dg-arrowhead)">
					<For each={statuses.slice(0, last)}>{(_, index) => <path d={arrow(index()).d} />}</For>
					<path
						class="dg-flow__alt"
						d={`M${cardX(sent)} ${returnY}H${centerX(draft)}V${laneOf(EvaluationStatus.DRAFT) + half + 3}`}
					/>
					<path
						class="dg-flow__alt"
						d={`M${cardX(requested) + FLOW.card} ${skipY}H${sealEdge(skipY)}`}
					/>
				</g>
				<g class="dg-flow__notes">
					<text x={centerX(draft)} y={returnY + 24}>
						要修正で戻す
					</text>
					<text x={centerX(requested + 1)} y={skipY - 10}>
						二次評価者なし
					</text>
				</g>
				<For each={statuses.slice(0, last)}>
					{(_, index) => (
						<g class="dg-flow__badge">
							<circle cx={arrow(index()).badge.x} cy={arrow(index()).badge.y} r="11" />
							<text x={arrow(index()).badge.x} y={arrow(index()).badge.y + 4}>
								{index() + 1}
							</text>
						</g>
					)}
				</For>
				<For each={statuses.slice(0, last)}>
					{(status, index) => (
						<g class="dg-flow__card">
							<rect
								x={cardX(index())}
								y={laneOf(status) - half}
								width={FLOW.card}
								height={FLOW.cardHeight}
								rx="6"
							/>
							<text x={centerX(index())} y={laneOf(status) + 5}>
								{status.label()}
							</text>
						</g>
					)}
				</For>
				<g class="dg-flow__seal">
					<circle cx={seal.x} cy={seal.y} r={seal.r} />
					<circle class="dg-flow__seal-inner" cx={seal.x} cy={seal.y} r={seal.r - 6} />
					<text x={seal.x} y={seal.y - 4}>
						評価
					</text>
					<text x={seal.x} y={seal.y + 26}>
						確定
					</text>
				</g>
			</svg>
		</div>
	);
};

/** 状態ごとの担当・すること・次へ進める操作。 */
export const StateTable: Component = () => (
	<div class="dg-table-wrap">
		<table class="dg-table dg-table--states">
			<caption class="visually-hidden">シートの状態と担当</caption>
			<thead>
				<tr>
					<th scope="col">状態</th>
					<th scope="col">担当</th>
					<th scope="col">この間にすること</th>
					<th scope="col">次へ進める操作</th>
				</tr>
			</thead>
			<tbody>
				<For each={EvaluationStatus.ALL}>
					{(status, index) => {
						const holder = status.holder();
						const guide = STATE_GUIDE[status.toString()];
						const next = nextStep(status);
						return (
							<tr>
								<th scope="row">{status.label()}</th>
								<td>
									{holder ? (
										<span class={`dg-chip dg-chip--${holder}`}>{ACTOR_LABEL[holder]}</span>
									) : (
										"なし"
									)}
								</td>
								<td>{guide.doing}</td>
								<td>
									<Show when={next} fallback="—">
										{(step) => (
											<div class="dg-next">
												<p>
													<span class="dg-badge">{index() + 1}</span>
													{ACTOR_LABEL[step().by]}が「{step().action}」
												</p>
												<Show when={guide.alt}>
													<p class="dg-small">{guide.alt}</p>
												</Show>
											</div>
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

/** いつ・誰が・何をできるか。行の判定はアクセスの決まりと同じ(helpGuide)。担当ごとに行をまとめる。 */
export const WritableMatrix: Component = () => {
	const groups = (["subject", "primary", "secondary"] as const).map((actor) => ({
		actor,
		rows: WRITABLE_ROWS.filter((row) => row.actor === actor),
	}));
	return (
		<div class="dg-table-wrap">
			<table class="dg-matrix">
				<caption class="visually-hidden">状態ごとに、誰が何をできるか</caption>
				<colgroup>
					<col class="dg-matrix__col-actor" />
					<col class="dg-matrix__col-label" />
					<For each={EvaluationStatus.ALL}>{() => <col />}</For>
				</colgroup>
				<thead>
					<tr>
						<td colSpan={2} />
						<For each={EvaluationStatus.ALL}>
							{(status) => <th scope="col">{status.label()}</th>}
						</For>
					</tr>
				</thead>
				<For each={groups}>
					{(group) => (
						<tbody class={`dg-matrix__group--${group.actor}`}>
							<For each={group.rows}>
								{(row, index) => (
									<tr>
										<Show when={index() === 0}>
											<th scope="rowgroup" rowSpan={group.rows.length} class="dg-matrix__actor">
												{ACTOR_LABEL[group.actor]}
											</th>
										</Show>
										<th scope="row">{row.label}</th>
										<For each={EvaluationStatus.ALL}>
											{(status) => (
												<td classList={{ "dg-matrix__yes": row.allowed(status) }}>
													<span class="visually-hidden">
														{row.allowed(status) ? "できる" : "できない"}
													</span>
												</td>
											)}
										</For>
									</tr>
								)}
							</For>
						</tbody>
					)}
				</For>
			</table>
		</div>
	);
};

// ---------------------------------------------------------------- 4. 目標

/** 1つの目標の3段と、書く時期。 */
export const GoalAnatomy: Component<{ maxGoals?: number }> = (props) => (
	<div class="dg-goal">
		<p class="dg-goal__tabs" aria-hidden="true">
			<span class="dg-goal__tab--on">目標1</span>
			<span>目標2</span>
			<span>目標3</span>
			<span>＋</span>
		</p>
		<p class="dg-small">
			{props.maxGoals
				? `目標は1枚に 1〜${props.maxGoals} 件。タブで切り替えます`
				: "目標は1枚に1件以上（上限は管理者が設定）。タブで切り替えます"}
		</p>
		<div class="dg-goal__sheet">
			<div class="dg-goal__challenge">
				<p class="dg-goal__name">チャレンジ目標</p>
				<p>この評価期間に達成すること。数値や期限を入れて書きます</p>
				<p class="dg-when dg-when--draft">下書きの間に書く</p>
			</div>
			<div class="dg-goal__pairs">
				<p class="dg-goal__head">
					期中目標<span class="dg-when dg-when--draft">下書きの間に書く</span>
				</p>
				<p class="dg-goal__head">
					達成状況<span class="dg-when dg-when--confirmed">目標の確定後に書く</span>
				</p>
				<For each={[1, 2]}>
					{(number) => (
						<>
							<p class="dg-goal__cell">期中目標 {number}：この期に取り組むこと</p>
							<p class="dg-goal__cell dg-goal__cell--result">実績・結果</p>
						</>
					)}
				</For>
			</div>
			<p class="dg-small">
				期中目標はチャレンジ目標ごとに 0〜4 件。0 件なら、達成状況はチャレンジ目標に対して書きます
			</p>
		</div>
	</div>
);

/** 前期のチャレンジ目標を、目標ごとに今期へ引き継ぐ。 */
export const CarryOverDiagram: Component = () => {
	const rows = [
		{
			before: "目標1",
			choice: "据え置く",
			after: "目標1　前期の文言のまま",
			tag: "前期から据え置き",
		},
		{
			before: "目標2",
			choice: "見直して更新",
			after: "目標2　書き直して保存",
			tag: "前期から更新",
		},
		{ before: "目標3", choice: "選ばない", after: "", tag: "" },
	];
	return (
		<div class="dg-carry">
			<p class="dg-carry__col">前期のチャレンジ目標</p>
			<p class="dg-carry__col" aria-hidden="true" />
			<p class="dg-carry__col">今期（下書きの間）</p>
			<For each={rows}>
				{(row) => (
					<>
						<p class="dg-carry__before">{row.before}</p>
						<p class="dg-carry__choice">
							<span>{row.choice}</span>
							<ArrowRight size={18} aria-hidden="true" />
						</p>
						<Show when={row.after} fallback={<p class="dg-carry__none">今期には入りません</p>}>
							<p class="dg-carry__after">
								{row.after}
								<span class="dg-chip dg-chip--subject">{row.tag}</span>
							</p>
						</Show>
					</>
				)}
			</For>
		</div>
	);
};

// ---------------------------------------------------------------- 5. 評価

/** 部下の評価: タイルで絞り、確定すると次の自分の番へ進む。 */
export const WorkspaceLoop: Component = () => (
	<ol class="dg-loop" aria-label="部下の評価の進め方">
		<li>
			<p class="dg-loop__tiles" aria-hidden="true">
				<span>
					目標を確認する<strong>2</strong>
				</span>
				<span>
					一次評価する<strong>3</strong>
				</span>
				<span>
					二次評価する<strong>1</strong>
				</span>
			</p>
			<p>タイルの数字が、あなたの番のシートの数。押すと一覧が絞り込まれます</p>
		</li>
		<li>
			<p class="dg-loop__step">「自分の番を評価する」</p>
			<p>あなたの番のシートを、一覧の順に開きます</p>
		</li>
		<li>
			<p class="dg-loop__step">評価して確定</p>
			<p>確定すると、次の自分の番のシートが自動で開きます</p>
		</li>
	</ol>
);

/** 送信された目標の確認は、確定か差し戻しの2択。 */
export const GoalReviewFork: Component = () => (
	<div class="dg-fork">
		<div class="dg-fork__from">
			<p class="dg-fork__state">目標確認待ち</p>
			<p class="dg-small">本人が送信した目標を、一次評価者が読む</p>
		</div>
		<div class="dg-fork__ways">
			<div class="dg-fork__way">
				<p class="dg-fork__action">
					<ArrowRight size={18} aria-hidden="true" />
					「目標を確定する」
				</p>
				<p class="dg-fork__state">振り返り待ち</p>
				<p class="dg-small">
					目標の内容・件数・順序が固定。本人が達成状況を書きます。採点は本人の依頼の後
				</p>
			</div>
			<div class="dg-fork__way dg-fork__way--back">
				<p class="dg-fork__action">
					<Undo2 size={18} aria-hidden="true" />
					「要修正として下書きに戻す」
				</p>
				<p class="dg-fork__state">下書き</p>
				<p class="dg-small">
					理由は必須（{GoalReturnReason.MAX_LENGTH}{" "}
					文字まで）。本人のシートと通知メールに、書いたとおりに出ます
				</p>
			</div>
		</div>
	</div>
);

/** 採点の3つの欄と確定。 */
export const ScoringAnatomy: Component<{ final?: string }> = (props) => (
	<div class="dg-score-parts">
		<ol class="dg-score-parts__list" aria-label="採点する欄">
			<li>
				<p class="dg-score-parts__name">チャレンジ目標</p>
				<p class="dg-scale">
					<span class="visually-hidden">1〜4 の4段階</span>
					<span aria-hidden="true">1</span>
					<span aria-hidden="true">2</span>
					<span aria-hidden="true">3</span>
					<span aria-hidden="true">4</span>
				</p>
				<p class="dg-small">目標のタブごとに。未採点のタブには「未評価」</p>
			</li>
			<li>
				<p class="dg-score-parts__name">共通評価</p>
				<p class="dg-scale">
					<span class="visually-hidden">1〜4 の4段階</span>
					<span aria-hidden="true">1</span>
					<span aria-hidden="true">2</span>
					<span aria-hidden="true">3</span>
					<span aria-hidden="true">4</span>
				</p>
				<p class="dg-small">項目ごとに。コメントも書ける。項目と配点は等級ごと</p>
			</li>
			<li>
				<p class="dg-score-parts__name">総評</p>
				<p class="dg-score-parts__text" aria-hidden="true">
					評価の理由と、今後への期待
				</p>
				<p class="dg-small">「総評を保存」で保存</p>
			</li>
		</ol>
		<Arrow />
		<div class="dg-score-parts__confirm">
			<p class="dg-form__button">{props.final ?? "一次評価を確定する"}</p>
			<p class="dg-small">
				<Lock size={14} aria-hidden="true" />
				未採点が残ると押せません（「自分の評価: あと〇件」から移れます）
			</p>
		</div>
	</div>
);

/** 一次評価の後の3つの道。 */
export const SecondPaths: Component = () => (
	<ul class="dg-paths" aria-label="一次評価の後">
		<li>
			<p class="dg-paths__case">二次評価者がいる</p>
			<p>
				一次評価の確定で、二次評価者に依頼が届く <Arrow />{" "}
				一次の点数・コメント・総評を見て、「二次評価」の欄で採点し、総評を書く <Arrow />
				「二次評価を確定する」
			</p>
			<p class="dg-paths__end">最終評価</p>
		</li>
		<li>
			<p class="dg-paths__case">二次評価者「なし」</p>
			<p>
				一次評価者のボタンが「評価を確定する」になる <Arrow /> 押すと、一次評価がそのまま最終評価
			</p>
			<p class="dg-paths__end">最終評価</p>
		</li>
		<li class="dg-paths--stop">
			<p class="dg-paths__case">二次評価者「未設定」</p>
			<p>
				最終評価をする人がいないので、確定できず止まる <Arrow /> 管理者に設定を依頼する
			</p>
			<p class="dg-paths__end">止まる</p>
		</li>
	</ul>
);

// ---------------------------------------------------------------- 6. 評価点

/** 配点の帯に例の点数を重ね、ランクの帯の上に結果を示す。 */
export const ScoreDiagram: Component<{
	allocation: { objective: number; common: number };
	source: string;
}> = (props) => {
	const example = () => scoreExample(props.allocation);
	const bands = rankBands();
	return (
		<div class="dg-points">
			<p class="dg-points__source">{props.source}</p>
			<div class="dg-points__bar" aria-hidden="true">
				<div style={{ "flex-grow": props.allocation.objective }}>
					<span
						style={{
							width: `${(example().objective / Math.max(props.allocation.objective, 1)) * 100}%`,
						}}
					/>
				</div>
				<div style={{ "flex-grow": props.allocation.common }}>
					<span
						style={{ width: `${(example().common / Math.max(props.allocation.common, 1)) * 100}%` }}
					/>
				</div>
			</div>
			<dl class="dg-points__parts">
				<div style={{ "flex-grow": props.allocation.objective }}>
					<dt>チャレンジ目標 {props.allocation.objective} 点</dt>
					<dd>例では {example().objective} 点（塗った部分）</dd>
					<dd>目標の点数の合計 ÷（目標の数 × 4）× 配点</dd>
				</div>
				<div style={{ "flex-grow": props.allocation.common }}>
					<dt>共通評価 {props.allocation.common} 点</dt>
					<dd>例では {example().common} 点（塗った部分）</dd>
					<dd>「項目の配点 × 評価」の合計 ÷（項目の配点の合計 × 4）× 配点</dd>
				</div>
			</dl>
			<p class="dg-points__example">
				例：目標1つを {SCORE_EXAMPLE.goal}、共通評価が {SCORE_EXAMPLE.commonMax} 点満点中{" "}
				{SCORE_EXAMPLE.common} 点なら、{props.allocation.objective} × {SCORE_EXAMPLE.goal}/
				{SCORE_EXAMPLE.goalMax} ＋ {props.allocation.common} × {SCORE_EXAMPLE.common}/
				{SCORE_EXAMPLE.commonMax} ＝ {example().objective} ＋ {example().common} ＝{" "}
				<strong>
					{example().total} 点（{example().rank}）
				</strong>
				。配点を掛けた後に1点単位で四捨五入して足します
			</p>
			<div class="dg-ranks">
				<p class="dg-ranks__pin" style={{ left: `${example().total}%` }} aria-hidden="true">
					{example().total}
				</p>
				<ol class="dg-ranks__bar" aria-label="評価点とランク">
					<For each={bands}>
						{(band, index) => (
							<li
								style={{
									"flex-grow": band.upper - band.minimum,
									"--dg-rank-mix": `${8 + index() * 6}%`,
								}}
								classList={{
									"dg-ranks__band--hit":
										example().total >= band.minimum &&
										(example().total < band.upper || band.upper === 100),
								}}
							>
								<strong>{band.rank}</strong>
								<span class="visually-hidden">
									{band.minimum === 0
										? `${band.upper}点未満`
										: `${band.minimum}点以上${band.upper}点未満`}
								</span>
							</li>
						)}
					</For>
				</ol>
				<p class="dg-ranks__ticks" aria-hidden="true">
					<For each={[...bands.map((band) => band.minimum), 100]}>
						{(value) => <span style={{ left: `${value}%` }}>{value}</span>}
					</For>
				</p>
			</div>
		</div>
	);
};

/** 誰に、いつ、何が見えるか。 */
export const VisibilityMatrix: Component = () => (
	<div class="dg-table-wrap">
		<table class="dg-table dg-table--visibility">
			<caption class="visually-hidden">点数が誰に、いつ見えるか</caption>
			<thead>
				<tr>
					<td />
					<th scope="col">評価確定まで</th>
					<th scope="col">評価確定の後</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<th scope="row">
						<span class="dg-chip dg-chip--subject">本人</span>
					</th>
					<td class="dg-hidden">点数もランクも見えません</td>
					<td>シートに目標ごとの一次評価の点数。共通評価・総評・評価点・ランクは PDF で</td>
				</tr>
				<tr>
					<th scope="row">
						<span class="dg-chip dg-chip--primary">一次評価者</span>
					</th>
					<td>自分の採点と見込みのランク。二次評価の点数は見えません</td>
					<td>すべて（PDF にも）</td>
				</tr>
				<tr>
					<th scope="row">
						<span class="dg-chip dg-chip--secondary">二次評価者</span>
					</th>
					<td>一次評価の点数・コメント・総評を見て採点</td>
					<td>すべて（PDF にも）</td>
				</tr>
			</tbody>
		</table>
	</div>
);

// ---------------------------------------------------------------- 7. 通知

/** 受け渡しのたびに、受け取る人へ届く。 */
export const NoticeDiagram: Component = () => (
	<div class="dg-notice">
		<ul class="dg-notice__list" aria-label="通知の宛先">
			<For each={notices()}>
				{(notice) => (
					<li>
						<span class="dg-notice__action">
							{ACTOR_LABEL[notice.from]}が「{notice.action}」
						</span>
						<Bell size={18} aria-hidden="true" />
						<span class={`dg-chip dg-chip--${notice.to}`}>{ACTOR_LABEL[notice.to]}</span>
					</li>
				)}
			</For>
			<li class="dg-notice__none" aria-hidden="true">
				<span class="dg-notice__action">二次評価者が「二次評価を確定する」</span>
				<BellOff size={18} />
				<span class="dg-small">届かない</span>
			</li>
		</ul>
	</div>
);

// ---------------------------------------------------------------- 8. 期の終わり

/** 締めると次の評価期間は準備中になり、開始して実施中になる。2つの操作は別の時点。 */
export const PeriodSwitchDiagram: Component = () => (
	<div class="dg-switch">
		<p class="dg-switch__row-label dg-switch--l1">今の評価期間</p>
		<p class="dg-switch__state dg-switch__state--active dg-switch--a1">
			{PeriodState.ACTIVE.label}
		</p>
		<p class="dg-switch__state dg-switch__state--closed dg-switch__state--after dg-switch--c1">
			{PeriodState.CLOSED.label}
		</p>
		<p class="dg-switch__row-label dg-switch--l2">次の評価期間</p>
		<p class="dg-switch__state dg-switch__state--waiting dg-switch--n2">
			{PeriodState.NOT_STARTED.label}
		</p>
		<p class="dg-switch__state dg-switch__state--preparing dg-switch__state--after dg-switch--p2">
			{PeriodState.PREPARING.label}
			<span class="dg-small">等級の変更などを反映。シートは作れません</span>
		</p>
		<p class="dg-switch__state dg-switch__state--active dg-switch__state--after dg-switch--s2">
			{PeriodState.ACTIVE.label}
		</p>
		<div class="dg-switch__moment dg-switch--m1">
			<p class="dg-switch__label">管理者が締める</p>
			<p class="dg-small">
				<Lock size={14} aria-hidden="true" />
				未確定のシートが残っていると締められません（「評価が確定していなくても締められる」期間を除く）
			</p>
		</div>
		<div class="dg-switch__moment dg-switch--m2">
			<p class="dg-switch__label">管理者が「この期間を開始する」</p>
			<p class="dg-small">開始できるのは準備中の評価期間だけ</p>
		</div>
	</div>
);

/** 期の分け方。分けた評価期間はそれぞれ独立。 */
export const DivisionDiagram: Component = () => (
	<ul class="dg-divisions" aria-label="期の分け方">
		<For each={PeriodDivision.ALL}>
			{(division) => (
				<li>
					<strong>{division.label}</strong>
					<span class="dg-divisions__bar">
						<For each={Array.from({ length: division.parts }, (_, index) => index + 1)}>
							{(part) => (
								<span class="dg-divisions__part">{division.partLabel(part) || "1年"}</span>
							)}
						</For>
					</span>
					<span class="dg-small">1つの期に {division.parts} 回評価</span>
				</li>
			)}
		</For>
	</ul>
);

/** 締めた後の誤りは、遡及処理で直し、記録と表示が残る。 */
export const CorrectionDiagram: Component = () => (
	<div class="dg-correction">
		<p class="dg-correction__node">締め済みのシート</p>
		<Arrow />
		<Who party="admin" screen="遡及処理">
			<p class="dg-small">項目ごとに、理由を添えて直す。期間は締め済みのまま</p>
		</Who>
		<Arrow />
		<ul class="dg-correction__outs">
			<li>本人・評価者のシートの上部と PDF に「締め後修正」（変更前後の内容・日時・理由）</li>
			<li>監査ログに、朱の印つきで記録</li>
		</ul>
	</div>
);

/**
 * くり返す手順を円に並べ、真ん中に循環の矢印を置く。上から時計回りに進む。
 * 狭い画面では、真ん中の言葉を先に出して縦に並べる。
 */
export const CycleDiagram: Component<{
	label: string;
	center: string;
	steps: { who: string; title: string; body: string }[];
}> = (props) => {
	// 楕円の上の位置(%)。0 番目を真上に置き、時計回り
	const at = (index: number, radius = { x: 36, y: 35 }) => {
		const angle = -Math.PI / 2 + (index / props.steps.length) * 2 * Math.PI;
		return { x: 50 + radius.x * Math.cos(angle), y: 50 + radius.y * Math.sin(angle), angle };
	};
	return (
		<div class="dg-cycle">
			<svg
				class="dg-cycle__orbit"
				viewBox="0 0 100 100"
				preserveAspectRatio="none"
				aria-hidden="true"
			>
				<ellipse cx="50" cy="50" rx="36" ry="35" />
			</svg>
			<For each={props.steps}>
				{(_, index) => {
					// 次の手順へ向かう向きを、2つの手順の間に置く
					const point = at(index() + 0.5);
					return (
						<span
							class="dg-cycle__tick"
							aria-hidden="true"
							style={{
								left: `${point.x}%`,
								top: `${point.y}%`,
								rotate: `${point.angle + Math.PI / 2}rad`,
							}}
						/>
					);
				}}
			</For>
			<p class="dg-cycle__center">
				<RefreshCw size={96} stroke-width={1.25} aria-hidden="true" />
				<span>{props.center}</span>
			</p>
			<ol class="dg-cycle__steps" aria-label={props.label}>
				<For each={props.steps}>
					{(step, index) => (
						<li style={{ left: `${at(index()).x}%`, top: `${at(index()).y}%` }}>
							<p class="dg-cycle__title">
								<span class="dg-badge">{index() + 1}</span>
								<span class="dg-cycle__who">{step.who}</span>
								{step.title}
							</p>
							<p class="dg-small">{step.body}</p>
						</li>
					)}
				</For>
			</ol>
		</div>
	);
};
