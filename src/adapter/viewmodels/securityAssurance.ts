import requirements from "../../../security/requirements.json";

/*
 * 管理者向けの「セキュリティの担保」。CI の正本(security/requirements.json)と
 * docs/security-verification.md から、何を毎回確かめ、何を確かめていないかを平易に言い直す。
 * 必須の検査 ID と ASVS の番号は正本から読む。検査が増えて説明が無ければ、テストで落ちる。
 */

/** 正本の検査 ID。JSON からは文字列としか分からないので、対応の漏れはテストで確かめる。 */
type RequirementId = string;

export interface SecurityCheck {
	id: string;
	/** 防ぐこと(攻撃・不正の側から)。 */
	title: string;
	/** 検査が確かめていること。 */
	guarantee: string;
	asvs: string[];
}

export interface SecurityGateGroup {
	title: string;
	checks: SecurityCheck[];
}

export interface SecurityMisuse {
	misuse: string;
	defense: string;
	evidence: string;
}

/** every: 毎回の検査で実際に試す。config: 設定・コードを検査する。design: 作りの上で起きない。 */
export type AttackCoverage = "every" | "config" | "design";

export interface SecurityAttack {
	name: string;
	coverage: AttackCoverage;
	detail: string;
}

export interface SecurityWatch {
	title: string;
	detail: string;
}

export interface SecurityLimit {
	title: string;
	detail: string;
	asvs: string[];
}

export interface SecurityAssuranceView {
	standard: string;
	/** 新規に作った DB と、旧版から移行した DB。どちらにも同じ検査を流す。 */
	databases: number;
	gates: SecurityGateGroup[];
	misuse: SecurityMisuse[];
	attacks: SecurityAttack[];
	watch: SecurityWatch[];
	limits: SecurityLimit[];
}

const CHECKS: Record<RequirementId, { title: string; guarantee: string }> = {
	"AUTH-LOGIN": {
		title: "本人だけが本人として入れる",
		guarantee:
			"本物のパスワード認証で、ログインした人がどの社員かを正しく特定し、その人のためのデータだけを返すこと。",
	},
	"AUTH-ANON": {
		title: "ログインしていない人は何も読めない",
		guarantee: "ログインしていない要求では、評価シートも管理用の操作も一切使えないこと。",
	},
	"AUTH-UNLINKED": {
		title: "社員に紐付かないアカウントは締め出す",
		guarantee:
			"認証そのものは通っても、社員に紐付いていないアカウントは、シートを読めず、管理用の操作もできないこと。",
	},
	"AUTH-JWT": {
		title: "偽造・期限切れの通行証は通らない",
		guarantee:
			"改ざんした・署名のない・期限が切れた・まだ有効になっていないトークン（ログインの通行証）を、API がすべて拒否すること。",
	},
	"AUTH-REVOKE": {
		title: "ログアウトした通行証は、期限前でも使えない",
		guarantee:
			"ログアウトしたセッションのトークンは、有効期限の前でも本人の特定に使えないこと。同じ人がほかの端末で開いているセッションは、そのまま使えること。",
	},
	"AUTH-RATE": {
		title: "パスワードの総当たりを止める",
		guarantee:
			"同じ接続元からのログイン試行に 80 回以内で制限がかかり、失敗の応答に通行証を含まないこと。送信元を偽るヘッダーでも制限を回避できず、正しいログインは 20 秒以内に戻ること。",
	},
	"ACCESS-BOLA": {
		title: "他人のシートは読めない・書けない",
		guarantee:
			"別の社員の本物のトークンで、他人のシートを読む・書き換える・状態を進めることができないこと。Admin は読めるが、書き換えも確定もできないこと。断った後に、保存内容が変わっていないことまで確かめます。",
	},
	"ACCESS-BFLA": {
		title: "管理者の操作は管理者だけ",
		guarantee:
			"社員や Reviewer が、権限の変更・招待コードの発行・特権的なシート操作・評価期間の締めと開始・全社のシート一覧の読み取り・等級と共通目標のマスタの読み書きを、画面を通さず API へ直接送っても拒否されること。",
	},
	"ACCESS-FIELDS": {
		title: "許された欄以外は書き込めない",
		guarantee:
			"本人の目標の編集に、本人が付けてはならない評価点を紛れ込ませると、要求全体を拒否すること（一部だけ通ることはない）。正しい編集はそのまま通ること。",
	},
	"ACCESS-SUSPEND": {
		title: "利用停止はその場で効く",
		guarantee:
			"利用停止にすると、それまで通っていた同じトークンのままでも、次の要求から拒否されること。",
	},
	"FLOW-APPROVAL": {
		title: "評価の手順は飛ばせない",
		guarantee:
			"一次評価者の目標確認を飛ばした状態の変更や、同じ提出の再送を拒否すること。通知も重複しないこと。",
	},
	"DATA-SECRET": {
		title: "メールサーバーのパスワードは誰にも読めない",
		guarantee: "保存した SMTP のパスワードを、社員はもちろん Admin でも API から取り出せないこと。",
	},
	"AUDIT-ATOMIC": {
		title: "監査の記録は偽造も削除もできない",
		guarantee:
			"API から監査記録を作る・消すことができないこと。記録の書き込みに失敗したら、Admin の操作そのものを取り消すこと（記録のない変更は残らない）。",
	},
	"DAST-AUTHENTICATED": {
		title: "攻撃ツールで実際に攻める",
		guarantee:
			"OWASP ZAP で、ログインした状態から SQL インジェクション・CRLF・パストラバーサル・コード注入を実際に送り込み、中程度以上の警告が1件でもあれば失敗にすること。偽の通行証では検査が失敗することも毎回確かめ、検査が空振りしていないことを保証します。",
	},
};

const GROUPS: { title: string; ids: RequirementId[] }[] = [
	{
		title: "ログインとなりすまし",
		ids: ["AUTH-LOGIN", "AUTH-ANON", "AUTH-UNLINKED", "AUTH-JWT", "AUTH-REVOKE", "AUTH-RATE"],
	},
	{
		title: "権限を越えた操作",
		ids: ["ACCESS-BOLA", "ACCESS-BFLA", "ACCESS-FIELDS", "ACCESS-SUSPEND"],
	},
	{ title: "評価の流れ・秘密・記録", ids: ["FLOW-APPROVAL", "DATA-SECRET", "AUDIT-ATOMIC"] },
	{ title: "外からの自動攻撃", ids: ["DAST-AUTHENTICATED"] },
];

const MISUSE: SecurityMisuse[] = [
	{
		misuse: "他人のシートの番号を指定して読む・PDF にする",
		defense:
			"シートを返す DB の関数と、行ごとの読み取り権限。PDF も同じ取得結果から画面の中で作るので、PDF 専用の抜け道はありません。",
		evidence: "ACCESS-BOLA、6つの状態 × 3つの立場の SQL テスト",
	},
	{
		misuse: "一次評価者が二次評価の点数を書き換える",
		defense: "評価の段階ごとに、書き込める人と欄を DB のトリガーで制限しています。",
		evidence: "評価者ごとの書き込みの SQL テスト",
	},
	{
		misuse: "評価確定前の点数を、本人や一次評価者がのぞく",
		defense:
			"本人には評価確定まで、一次評価者には二次評価の点数を評価確定まで、DB が返しません。画面で隠すだけではありません。",
		evidence: "点数の公開範囲の SQL テスト",
	},
	{
		misuse: "締めた評価期間のシートを、API を直接呼んで書き換える",
		defense:
			"期間と状態を見るトリガーが断ります。締めた後に直せるのは遡及処理だけで、必ず理由と監査記録が残ります。",
		evidence: "期間の締めと遡及処理の SQL テスト",
	},
	{
		misuse: "前に送った依頼・確定の要求を、もう一度送る",
		defense: "状態の変更は、そのときの状態と権限で毎回確かめ直します。",
		evidence: "FLOW-APPROVAL、通知の重複防止の SQL テスト",
	},
	{
		misuse: "要求に権限・評価者・社員の紐付けをこっそり書き足す",
		defense: "列ごとの書き込み権限とトリガーで、要求全体を拒否します。",
		evidence: "ACCESS-FIELDS、Mass Assignment の SQL テスト",
	},
	{
		misuse: "2人が同時に保存・確定して、食い違った状態を作る",
		defense:
			"行のロックと1つのトランザクションで処理します。Admin の操作は、画面で見ていた状態と照合し、食い違えば断ります。",
		evidence: "本物の PostgreSQL の別々の接続で同時に操作する検査",
	},
	{
		misuse: "最後の Admin を降格・停止して、誰も管理できなくする",
		defense: "利用できる登録済みの Admin が0人になる変更は、同時に行っても DB が断ります。",
		evidence: "社員の権限の SQL テスト、同時降格の検査",
	},
	{
		misuse: "管理者が過去の評価をこっそり直す",
		defense:
			"理由・変更前後の値を監査記録に残し、記録に失敗したら修正ごと取り消します。直した項目は本人のシートと PDF にも「締め後修正」として出ます。",
		evidence: "AUDIT-ATOMIC、遡及処理の SQL テスト",
	},
	{
		misuse: "コメントや目標に HTML・スクリプトを仕込む",
		defense:
			"どの画面も文字として表示し、HTML として解釈する書き方がコードに1つもないことを検査しています。",
		evidence: "実ブラウザでの表示検査、コードの静的検査",
	},
];

const ATTACKS: SecurityAttack[] = [
	{
		name: "XSS（クロスサイトスクリプティング）",
		coverage: "every",
		detail:
			"script・img の onerror・SVG・iframe・javascript: の URL を実際のブラウザで表示させ、文字として出ることを確かめます。読み込めるスクリプトは自分の配布物だけに限っています（CSP）。",
	},
	{
		name: "SQL インジェクション",
		coverage: "every",
		detail:
			"SQL 風の文字列を保存・取得しても文字のまま残り、権限も変わらないことを確かめます。攻撃ツールの SQL 注入の検査も毎回流します。",
	},
	{
		name: "CSRF（なりすまし送信）",
		coverage: "design",
		detail:
			"ログインに Cookie を使わず、要求ごとに通行証を明示して送るため、ほかのサイトから勝手に操作させることができません。",
	},
	{
		name: "クリックジャッキング",
		coverage: "config",
		detail: "ほかのサイトに画面を埋め込ませない設定（frame-ancestors など）を検査しています。",
	},
	{
		name: "CSV の数式インジェクション",
		coverage: "every",
		detail:
			"出力する CSV の「=」「+」「-」「@」で始まる値を無害化します。取り込む CSV はサイズの上限があり、形式が崩れていれば全体を拒否します。",
	},
	{
		name: "Prototype Pollution",
		coverage: "every",
		detail: "通知の API に __proto__ などを混ぜても、権限や宛先が変わらないことを確かめます。",
	},
	{
		name: "不正な形の入力（デシリアライズ）",
		coverage: "every",
		detail:
			"型の違う JSON や壊れた構造を拒否します。受け取ったデータをプログラムとして実行する仕組みは使っていません。",
	},
	{
		name: "パストラバーサル",
		coverage: "every",
		detail:
			"PDF の保存先は、ダイアログで選んだ場所だけに限られることを確かめます。攻撃ツールの検査にも含めています。",
	},
	{
		name: "巨大な要求",
		coverage: "every",
		detail: "通知の API の本文と、取り込む CSV（20MiB まで）のサイズの上限を確かめます。",
	},
	{
		name: "配布物への秘密の混入",
		coverage: "config",
		detail:
			"公開する前に、配布物にソースマップ・秘密鍵・管理用の鍵が入っていないことを検査します。中にあるのは公開してよい URL と鍵だけです。",
	},
];

const WATCH: SecurityWatch[] = [
	{
		title: "DB の権限の台帳",
		detail:
			"DB の関数・権限・行ごとのポリシー・トリガー・制約を一覧にし、期待値と1行ずつ照合します。意図しない権限が1つ増えても、CI が止まります。",
	},
	{
		title: "新しく作った DB と、移行した DB の両方",
		detail:
			"同じ検査を、まっさらに作った DB と、旧版から移行した DB の両方に流します。移行の途中で守りが抜けることを防ぎます。",
	},
	{
		title: "落ちたら配布しない",
		detail:
			"すべての検査が通ったときだけ、配布物を作ります。1つでも失敗・未実行・不明な検査があれば、全体を失敗にします。",
	},
	{
		title: "依存ライブラリ",
		detail:
			"使うライブラリの版を固定し、既知の脆弱性を毎回検査します（bun audit・cargo audit）。CI が使う外部の部品も、版を書き換えられないよう固定しています。",
	},
	{
		title: "アプリの更新",
		detail:
			"更新は署名を確かめてから入れます。更新の取得先が HTTPS であること、公開鍵があることを検査します。",
	},
	{
		title: "検査の証跡",
		detail:
			"検査ごとの結果、攻撃ツールのレポート、使った設定のハッシュを CI に保存します。トークンやパスワードは取り除いてから残します。",
	},
];

const LIMITS: SecurityLimit[] = [
	{
		title: "分散した総当たり・アカウント単位の制限",
		detail:
			"検査するのは同じ接続元からの総当たりだけです。本番の Supabase Auth で、パスワードを長くし（12文字以上を推奨）、漏えいしたパスワードを拒否する設定にしてください。",
		asvs: ["V6.3.1"],
	},
	{
		title: "多要素認証と、別の経路でのログイン",
		detail:
			"多要素認証は必須にしていません。パスワードを忘れたときは、Admin が登録を取り消して招待し直す運用です。",
		asvs: ["V6.3.3", "V6.3.4"],
	},
	{
		title: "通行証の発行元・宛先の確かめ",
		detail:
			"トークンの発行元（issuer）と宛先（audience）の決まりは、本番の Supabase 側の設定に任せています。",
		asvs: ["V9.2.2", "V9.2.3"],
	},
	{
		title: "本番環境そのものの設定",
		detail:
			"CI は隔離した検証環境で確かめます。本番の Auth の設定や、Web 版で実際に返るヘッダーは、変えたときに手で確かめてください。",
		asvs: ["V12"],
	},
	{
		title: "Admin が指定するメールサーバーの接続先",
		detail:
			"「設定」の通知では、Admin が任意のメールサーバーを指定できます。社内で信頼できるメールサーバーだけを設定してください。",
		asvs: ["V1.3.6"],
	},
	{
		title: "同じ欄を2人が同時に書いたとき",
		detail: "状態は食い違いませんが、同じ欄の文章は後から保存した方が残ります。",
		asvs: [],
	},
	{
		title: "端末の保護",
		detail:
			"共有PCの画面ロックや、端末に残ったログインは端末側の管理です。共有PCを使う社員は、社員マスタの「ログイン」を「閉じたらログアウト」にしてください。",
		asvs: [],
	},
];

const ASVS_OF = new Map<string, string[]>(
	requirements.required.map((requirement) => [requirement.id, requirement.asvs]),
);

export function buildSecurityAssurance(): SecurityAssuranceView {
	return {
		standard: requirements.standard,
		databases: 2,
		gates: GROUPS.map((group) => ({
			title: group.title,
			checks: group.ids.map((id) => ({ id, ...CHECKS[id], asvs: ASVS_OF.get(id) ?? [] })),
		})),
		misuse: MISUSE,
		attacks: ATTACKS,
		watch: WATCH,
		limits: LIMITS,
	};
}
