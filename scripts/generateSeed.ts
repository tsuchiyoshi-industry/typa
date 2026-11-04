/**
 * デモ用のダミーデータ `supabase/seed.sql` を Faker で作り直す。
 *
 *   bun scripts/generateSeed.ts [seed]
 *
 * 同じ seed なら毎回同じ内容になる。流した DB の社員・シート・Auth ユーザーは**すべて消えて**置き換わる。
 * 合計点・ランク・通知は、シートの状態を下書きから順に進めて本物のトリガーに作らせる。
 */
import { writeFileSync } from "node:fs";
import { fakerJA as faker } from "@faker-js/faker";

const SEED = Number(process.argv[2] ?? 2026);
const DOMAIN = "example.com";
const PASSWORD = "typa-demo";
faker.seed(SEED);

const q = (v: string | number | boolean | null | undefined) =>
	v === null || v === undefined
		? "null"
		: typeof v === "string"
			? `'${v.replaceAll("'", "''")}'`
			: String(v);
const row = (...values: Parameters<typeof q>[0][]) => `(${values.map(q).join(",")})`;
const pick = faker.helpers.arrayElement;
const int = (min: number, max: number) => faker.number.int({ min, max });
const clamp = (n: number) => Math.min(4, Math.max(1, Math.round(n)));

// ---- 共通評価(等級ごとの項目セット) ----
const itemSets = [
	{
		id: 1,
		name: "管理職",
		items: [
			["方針の共有", "会社の方針を部下にわかる言葉で伝え、部の向かう先をそろえていた。"],
			["部下育成", "部下の力を見て仕事を任せ、成長の機会をつくっていた。"],
			["判断力", "情報が足りない場面でも、根拠を示して速やかに決めていた。"],
			["組織運営", "部の目標と体制を整え、メンバーが動きやすい環境をつくっていた。"],
			["部門間調整", "他部門と利害が食い違っても、話し合いで落としどころを見つけていた。"],
			["問題解決", "起きた問題の原因を突き止め、再発しない手を打っていた。"],
		],
	},
	{
		id: 2,
		name: "中堅",
		items: [
			["計画性", "期限から逆算して段取りを組み、遅れそうなときは早めに相談していた。"],
			["改善提案", "仕事のやり方の無駄に気づき、具体的な改善を提案・実行していた。"],
			["後輩指導", "後輩の質問に丁寧に答え、自分で考えられるよう導いていた。"],
			["専門知識", "担当業務に必要な知識を身につけ、周りに頼られていた。"],
			["責任感", "引き受けた仕事を最後までやり遂げていた。"],
			["協調性", "周りの状況に気を配り、自分から手助けしていた。"],
			["報連相", "必要なことを、必要な相手に、遅れずに伝えていた。"],
		],
	},
	{
		id: 3,
		name: "一般",
		items: [
			["規律性", "決まりや約束を守り、身だしなみや時間にも気を配っていた。"],
			["積極性", "言われる前に自分から仕事を見つけて取り組んでいた。"],
			["正確性", "確認を怠らず、ミスの少ない仕事をしていた。"],
			["責任感", "任された仕事を最後までやり遂げていた。"],
			["協調性", "周りと協力し、気持ちよく仕事を進めていた。"],
			["報連相", "困ったことや進み具合を、上司に早めに伝えていた。"],
		],
	},
];
let itemId = 0;
const items = itemSets.flatMap((set) =>
	set.items.map(([title, description]) => ({
		id: ++itemId,
		setId: set.id,
		title,
		description,
		weight: pick([1, 1, 2]),
	})),
);
const grades = [
	{ id: 1, name: "総合Ⅲ級", setId: 1, course: "総合職" },
	{ id: 2, name: "総合Ⅱ級", setId: 2, course: "総合職" },
	{ id: 3, name: "総合Ⅰ級", setId: 3, course: "総合職" },
	{ id: 4, name: "一般Ⅱ級", setId: 2, course: "一般職" },
	{ id: 5, name: "一般Ⅰ級", setId: 3, course: "一般職" },
	{ id: 6, name: "技能Ⅱ級", setId: 2, course: "技能職" },
	{ id: 7, name: "技能Ⅰ級", setId: 3, course: "技能職" },
];

// ---- 社員 ----
type Role = "Admin" | "Reviewer" | "Employee";
type Employee = {
	id: number;
	no: string;
	name: string;
	role: Role;
	gradeId: number;
	course: string;
	hired: string; // YYYY-MM
	primary?: number;
	secondary?: number;
	noSecondary: boolean;
	registered: boolean;
	enabled: boolean;
	ability: number;
	userId: string;
};
const usedNos = new Set<string>();
const employees: Employee[] = [];
const addEmployee = (role: Role, gradeId: number, hiredFrom: number, hiredTo: number) => {
	const grade = grades.find((g) => g.id === gradeId) as (typeof grades)[number];
	let no: string;
	let hired: string;
	do {
		const year = int(hiredFrom, hiredTo);
		const month = faker.datatype.boolean(0.7) ? 4 : int(1, 12);
		hired = `${year}-${String(month).padStart(2, "0")}`;
		no = `${year}${String(month).padStart(2, "0")}${String(int(0, 99)).padStart(3, "0")}`;
	} while (usedNos.has(no));
	usedNos.add(no);
	const e: Employee = {
		id: employees.length + 1,
		no,
		name: faker.person.fullName(),
		role,
		gradeId,
		course: grade.course,
		hired,
		noSecondary: false,
		registered: true,
		enabled: true,
		ability: faker.number.float({ min: 1.8, max: 3.7 }),
		userId: faker.string.uuid(),
	};
	employees.push(e);
	return e;
};
// 610 人の組織: Admin(社長) → 部長(二次評価者) → 課長(一次評価者) → 課員。
// 全員が 1期 の前に入社している(全期間にシートがある)
const HEADCOUNT = 610;
const admin = addEmployee("Admin", 1, 1988, 1992);
type Team = { primary: Employee; secondary?: Employee; grades: number[] };
const seniors: Employee[] = [];
const reviewers: Employee[] = [];
const teams: Team[] = [];
for (let d = 0; d < 12; d++) {
	// 部の半分は事務系(総合職・一般職)、半分は現場(技能職中心)
	const memberGrades = d % 2 === 0 ? [2, 3, 3, 4, 5, 5] : [2, 6, 6, 7, 7, 7];
	const head = addEmployee("Reviewer", 1, 1988, 1998);
	head.primary = admin.id;
	head.noSecondary = true;
	seniors.push(head);
	for (let s = 0; s < int(4, 5); s++) {
		const chief = addEmployee("Reviewer", pick([1, 2]), 1995, 2010);
		chief.primary = head.id;
		chief.secondary = admin.id;
		reviewers.push(chief);
		teams.push({ primary: chief, secondary: head, grades: memberGrades });
	}
	// 部の直轄チームは、部長が一次評価者で二次評価者なし
	if (faker.datatype.boolean(0.4)) {
		teams.push({ primary: head, grades: memberGrades });
	}
}
const staff: Employee[] = [];
for (let n = 0; employees.length < HEADCOUNT; n++) {
	// まず全チームに1人ずつ、残りはばらつきを持たせて配る
	const team = teams[n] ?? pick(teams);
	const e = addEmployee("Employee", pick(team.grades), 2000, 2021);
	e.primary = team.primary.id;
	e.secondary = team.secondary?.id;
	e.noSecondary = !team.secondary;
	staff.push(e);
}
// 登録前の社員(登録・招待の説明用)と、利用停止中の社員を少し混ぜる
const unregistered = faker.helpers.arrayElements(staff, 20);
for (const e of unregistered) {
	e.registered = false;
}
for (const e of faker.helpers.arrayElements(
	staff.filter((e) => e.registered),
	10,
)) {
	e.enabled = false;
}

// ---- 評価期間: 1〜5期を上期・下期に分ける。最後(5期 下期)だけが実施中 ----
const periods = [1, 2, 3, 4, 5].flatMap((term) => {
	const year = 2021 + term;
	return [1, 2].map((part) => ({
		id: (term - 1) * 2 + part,
		name: `${term}期 ${part === 1 ? "上期" : "下期"}`,
		term: `${term}期`,
		division: "half",
		part,
		start: part === 1 ? `${year}-03-23` : `${year}-09-23`,
		end: part === 1 ? `${year}-09-22` : `${year + 1}-03-22`,
		closedAt: term === 5 && part === 2 ? null : part === 1 ? `${year}-10-20` : `${year + 1}-04-20`,
	}));
});
const FLOW = [
	"draft",
	"goals_submitted",
	"goals_confirmed",
	"submitted",
	"first_evaluated",
	"finalized",
];
const stage = (status: string) => FLOW.indexOf(status);

// ---- 文面 ----
const goalTemplates: Record<string, (() => string)[]> = {
	総合職: [
		() => `新規顧客を${int(3, 10)}社開拓し、${int(2, 5)}社から受注する`,
		() => `担当エリアの売上を前年比${int(105, 120)}%に伸ばす`,
		() => `${pick(["在庫管理", "受発注", "顧客管理"])}システムの切り替えを期限内に終える`,
		() => "部内の業務手順書を整え、引き継ぎにかかる日数を半分にする",
		() => `若手${int(1, 3)}名の OJT を担当し、一人で担当先を回れるようにする`,
		() => `見積の提出までの日数を平均${int(1, 3)}日縮める`,
	],
	一般職: [
		() => "請求書処理の入力ミスをゼロにする",
		() => `経費精算の確認手順を見直し、処理を${int(1, 3)}日早める`,
		() => `電話の問い合わせをその場で解決する割合を${int(70, 90)}%にする`,
		() => "共有フォルダの整理ルールを作り、部内に定着させる",
		() => "月次の定型集計をマクロで自動化する",
		() => `日商簿記${pick(["2", "3"])}級に合格する`,
	],
	技能職: [
		() => `加工不良率を${pick(["0.5", "0.8", "1.0"])}%以下に抑える`,
		() => `段取り替えの時間を${int(5, 20)}分縮める`,
		() => `${pick(["フォークリフト", "クレーン", "玉掛け"])}の資格を取る`,
		() => "5S 活動を主導し、職場点検で A 評価を取る",
		() => `後輩${int(1, 3)}名に基本作業を教え、一人で作業できるようにする`,
		() => `ヒヤリハットの報告を月${int(2, 5)}件以上出す`,
	],
};
const steps = [
	"現状を調べて課題を洗い出す",
	"進め方を決めて上長と合意する",
	"試しにやってみて効果を測る",
	"結果をまとめて部内に共有する",
];
const achievementFor = (score: number) =>
	pick(
		[
			[
				"着手が遅れ、未達となった。原因を整理して次期に取り組み直す。",
				"途中で優先度が下がり、ほとんど進まなかった。",
			],
			["半分ほど進んだ。残りは次期に持ち越す。", "一部は達成したが、目標の水準には届かなかった。"],
			["予定どおり達成した。", "計画どおりに進み、期限内に終えた。"],
			[`目標を上回った（目標比 ${int(110, 140)}%）。`, "関係部署の協力を得て、前倒しで達成した。"],
		][score - 1] as string[],
	);
const commentFor = (score: number) =>
	pick(
		[
			["もう一歩踏み込んだ取り組みを期待します。", "周りに相談しながら進めると良いでしょう。"],
			[
				"概ねできていますが、ばらつきがありました。",
				"意識はできています。行動に移す回数を増やしましょう。",
			],
			["安定してできていました。", "周りからの信頼も厚く、よくできていました。"],
			["部の手本になっていました。", "期待を大きく上回る働きでした。"],
		][score - 1] as string[],
	);
const overall = (score: number) =>
	score >= 3.2
		? pick([
				"期を通じて高い成果を出しました。次期はより大きな役割を任せたいと考えています。",
				"目標を確実に達成し、周りへの良い影響も見られました。",
			])
		: score >= 2.5
			? pick([
					"概ね目標どおりの成果でした。次期は自分から提案する場面を増やしてください。",
					"安定した働きでした。得意分野をさらに伸ばしていきましょう。",
				])
			: pick([
					"目標に届かない項目がありました。早めの相談を心がけてください。",
					"取り組みの姿勢は見えました。次期は計画の立て方から一緒に見直しましょう。",
				]);

// ---- SQL ----
const out: string[] = [];
const sql = (s: string) => out.push(s);
sql(`-- このファイルは scripts/generateSeed.ts が作る(seed ${SEED})。手で直さず、スクリプトを直して作り直す。
-- 流した DB の社員・評価シート・Auth ユーザーはすべて消え、ダミーデータに置き換わる。
begin;
truncate public.notifications, public.sheet_notification_deliveries, public.sheet_corrections,
  public.security_audit_log, public.privileged_sheet_context, public.registration_tickets,
  public.employee_invitations, public.milestones, public.common_evaluation_results,
  public.evaluation_sheets, public.evaluation_periods, public.employee_contacts, public.employees,
  public.employee_grades, public.common_evaluation_items, public.common_evaluation_item_sets
  restart identity cascade;
delete from auth.users;
insert into public.roles(role_name) values('Admin'),('Reviewer'),('Employee') on conflict(role_name) do nothing;
insert into public.evaluation_settings(id,objective_allocation,common_allocation,max_challenge_goals) values(true,20,80,4)
  on conflict(id) do update set objective_allocation=20, common_allocation=80, max_challenge_goals=4;
insert into public.workspace_settings(id,required_domain) values(true,${q(DOMAIN)})
  on conflict(id) do update set required_domain=${q(DOMAIN)}, notification_channel='in_app',
    smtp_host='', smtp_user='', smtp_password='', smtp_verified_at=null;`);
sql(`insert into public.common_evaluation_item_sets(id,name) values
${itemSets.map((s) => row(s.id, s.name)).join(",\n")};`);
sql(`insert into public.common_evaluation_items(id,item_set_id,title,description,weight) values
${items.map((i) => row(i.id, i.setId, i.title, i.description, i.weight)).join(",\n")};`);
sql(`insert into public.employee_grades(id,grade_name,item_set_id) values
${grades.map((g) => row(g.id, g.name, g.setId)).join(",\n")};`);

const registered = employees.filter((e) => e.registered);
const contact = (e: Employee) => `typa-demo-${e.no}@${DOMAIN}`;
sql(`insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,
  raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,email_change_token_new,email_change)
select '00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated', 'authenticated', u.email, pw.hash, now(), now(), now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('employee_no', u.no, 'contact_email', u.contact, 'email_verified', true), '', '', '', ''
from (select extensions.crypt(${q(PASSWORD)}, extensions.gen_salt('bf')) as hash) pw,
(values
${registered.map((e) => row(e.userId, `typa-${e.no.toLowerCase()}@${DOMAIN}`, e.no, contact(e))).join(",\n")}
) as u(id,email,no,contact);`);
const roleOf = (r: Role) => `(select id from public.roles where role_name=${q(r)})`;
// 評価者を指す外部キーは文の終わりに確かめられるので、同じ INSERT の中の相手を指せる
sql(`insert into public.employees(id,user_id,name,employee_no,role_id,career_course,grade_id,is_enabled,primary_evaluator_id,secondary_evaluator_id,no_secondary_evaluator) values
${employees
	.map(
		(e) =>
			`(${[e.id, q(e.registered ? e.userId : null), q(e.name), q(e.no), roleOf(e.role), q(e.course), e.gradeId, e.enabled, q(e.primary), q(e.secondary), e.noSecondary].join(",")})`,
	)
	.join(",\n")};`);
sql(`insert into public.employee_contacts(employee_id,email) values
${employees
	.filter((e) => e.role !== "Employee" && e.registered)
	.map((e) => row(e.id, contact(e)))
	.join(",\n")};`);
sql(`insert into public.evaluation_periods(id,period_name,term_name,division,part,start_date,end_date,is_active) values
${periods.map((p) => row(p.id, p.name, p.term, p.division, p.part, p.start, p.end, false)).join(",\n")};`);

let sheetId = 0;
for (const period of periods) {
	const active = period.closedAt === null;
	sql(
		`\n-- ${period.name}\nupdate public.evaluation_periods set is_active=true where id=${period.id};`,
	);
	const sheets: string[] = [];
	const goalRows: string[] = [];
	const resultRows: string[] = [];
	const reached: number[][] = FLOW.map(() => []);
	for (const e of employees) {
		if (e.role === "Admin") {
			continue;
		}
		// 実施中の期間の状態はランダム。締めた期間は全員確定
		const at = active ? int(0, FLOW.length - 1) : stage("finalized");
		const id = ++sheetId;
		for (let s = 1; s <= at; s++) {
			reached[s]?.push(id);
		}
		const firstDone = at >= stage("first_evaluated");
		const secondDone = at >= stage("finalized") && !e.noSecondary;
		const ability = e.ability + faker.number.float({ min: -0.4, max: 0.4 });
		const score = () => clamp(ability + faker.number.float({ min: -0.9, max: 0.9 }));
		const second = (first: number) => clamp(first + pick([-1, 0, 0, 0, 0, 1]));
		sheets.push(
			row(
				id,
				period.id,
				e.id,
				firstDone ? overall(ability) : "",
				secondDone ? overall(ability) : "",
			),
		);
		const goals = faker.helpers.arrayElements(
			goalTemplates[e.course] as (() => string)[],
			int(1, 4),
		);
		goals.forEach((goal, i) => {
			const first = firstDone ? score() : 0;
			const written =
				at >= stage("goals_confirmed") &&
				(at > stage("goals_confirmed") || faker.datatype.boolean(0.5));
			const result = first || score();
			const periodGoals = faker.datatype.boolean(0.5)
				? steps.slice(0, int(2, 4)).map((description) => ({
						description,
						achievement: written ? achievementFor(result) : "",
					}))
				: [];
			goalRows.push(
				row(
					id,
					i + 1,
					goal(),
					JSON.stringify(periodGoals),
					written && !periodGoals.length ? achievementFor(result) : "",
					first,
					secondDone ? second(first) : 0,
				),
			);
		});
		if (firstDone) {
			const set = (grades.find((g) => g.id === e.gradeId) as (typeof grades)[number]).setId;
			for (const i of items.filter((i) => i.setId === set)) {
				const first = score();
				resultRows.push(
					row(
						id,
						i.id,
						first,
						secondDone ? second(first) : 0,
						faker.datatype.boolean(0.4) ? commentFor(first) : "",
					),
				);
			}
		}
	}
	sql(`insert into public.evaluation_sheets(id,period_id,employee_id,first_overall_comment,second_overall_comment) values
${sheets.join(",\n")};`);
	sql(`insert into public.milestones(sheet_id,goal_number,challenge_goal,period_goals,achievement,first_score,second_score) values
${goalRows.join(",\n")};`);
	if (resultRows.length) {
		sql(`insert into public.common_evaluation_results(sheet_id,item_id,first_score,second_score,first_comment) values
${resultRows.join(",\n")};`);
	}
	// 状態を1段ずつ進め、合計点・ランク・通知をトリガーに作らせる(トリガーは行ごとに動く)
	FLOW.forEach((next, s) => {
		if (s > 0 && reached[s]?.length) {
			sql(
				`update public.evaluation_sheets set status='${next}' where id = any('{${reached[s].join(",")}}'::bigint[]);`,
			);
		}
	});
	if (!active) {
		sql(
			`update public.evaluation_periods set is_active=false, closed_at=${q(`${period.closedAt} 09:00+09`)} where id=${period.id};`,
		);
	}
}
sql(`
-- 締めた期間の通知は消す。seed の通知は作成時刻がすべて同じなので、残すと実施中の依頼が埋もれる
delete from public.notifications n using public.evaluation_sheets s
  join public.evaluation_periods p on p.id=s.period_id
  where n.sheet_id=s.id and not p.is_active;
${[
	"common_evaluation_item_sets",
	"common_evaluation_items",
	"employee_grades",
	"employees",
	"evaluation_periods",
	"evaluation_sheets",
]
	.map(
		(t) =>
			`select setval(pg_get_serial_sequence('public.${t}','id'), (select max(id) from public.${t}));`,
	)
	.join("\n")}
commit;
`);
writeFileSync("supabase/seed.sql", out.join("\n"));

const login = (label: string, e: Employee) => `  ${label.padEnd(10)} ${e.no}  ${e.name}`;
console.log(`supabase/seed.sql を作りました(seed ${SEED}、社員 ${employees.length} 人、シート ${sheetId} 枚)。
パスワードは全員 ${PASSWORD}
${login("管理者", admin)}
${login("二次評価者", seniors[0] as Employee)}
${login("一次評価者", reviewers[0] as Employee)}
${login("被評価者", staff.find((e) => e.registered && e.enabled && e.primary === reviewers[0]?.id) ?? (staff.find((e) => e.registered && e.enabled) as Employee))}`);
