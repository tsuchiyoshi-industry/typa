import { type AuditCategory, auditCategoryOf } from "../../domain/entities/AuditEvent";
import type { AuditLogRecord, AuditPerson } from "../../domain/repositories/AuditLogRepository";
import type { EmployeeGrade } from "../../domain/repositories/EmployeeMasterRepository";
import {
	EVALUATION_STATUS_VALUES,
	EvaluationStatus,
	type EvaluationStatusValue,
} from "../../domain/valueObjects/EvaluationStatus";

/** 記録の ID を名前にするための台帳。画面を開いたときに一度だけ作る。 */
export interface AuditDirectory {
	people: ReadonlyMap<number, AuditPerson>;
	accounts: ReadonlyMap<string, AuditPerson>;
	roles: ReadonlyMap<number, string>;
	grades: ReadonlyMap<number, string>;
	periods: ReadonlyMap<number, string>;
	sheets: ReadonlyMap<number, { employeeId: number; periodId: number; periodName: string }>;
}

export function createAuditDirectory(source: {
	people: readonly AuditPerson[];
	roles: ReadonlyMap<number, string>;
	grades: readonly EmployeeGrade[];
	periods: readonly { id: number; periodName: string }[];
	sheets: readonly { id: number; employeeId: number; periodId: number; periodName: string }[];
}): AuditDirectory {
	return {
		people: new Map(source.people.map((person) => [person.id, person])),
		accounts: new Map(
			source.people.flatMap((person) => (person.userId ? [[person.userId, person] as const] : [])),
		),
		roles: source.roles,
		grades: new Map(source.grades.map((grade) => [grade.id, grade.name])),
		periods: new Map(source.periods.map((period) => [period.id, period.periodName])),
		sheets: new Map(source.sheets.map(({ id, ...sheet }) => [id, sheet])),
	};
}

/** 社員番号の分からない人(システム・消えたアカウント)は employeeNo が null。 */
export interface AuditPersonRef {
	name: string;
	employeeNo: string | null;
}

export interface AuditEntryView {
	id: number;
	occurredAt: string;
	/** その地域の日付(YYYY-MM-DD)と時刻(HH:mm)。 */
	day: string;
	time: string;
	category: AuditCategory | "other";
	title: string;
	/** 検印。Admin が通常の手順を越えた操作だけ。 */
	seal: { glyph: string; label: string } | null;
	actor: AuditPersonRef;
	/**
	 * 何に対する記録か。シートが残っていれば sheetId で開ける。
	 * 対象が分からなければ missing に理由を入れる。
	 */
	subject: {
		person: AuditPersonRef | null;
		periodName: string | null;
		sheetId: number | null;
		missing: string | null;
	} | null;
	changes: { label: string; before: string; after: string }[];
	facts: { label: string; value: string }[];
	reason: string | null;
	/** 記録の原文(details)。 */
	raw: string;
}

const SEALS: Record<string, { glyph: string; label: string }> = {
	"sheet.corrected": { glyph: "訂", label: "締め後修正" },
	"sheet.privileged_status": { glyph: "特", label: "特権での状態変更" },
	"sheet.privileged_delete": { glyph: "削", label: "シートの削除" },
	"sheet.grade_change": { glyph: "級", label: "等級の変更" },
};

/** 前へ進めたときの呼び名。シートの画面のボタンと同じ言葉にする(行き先の状態で決まる)。戻したときは「〜に戻す」。 */
const STEP_TITLES: Record<EvaluationStatusValue, string> = {
	draft: "下書きに戻す",
	goals_submitted: "目標を送信",
	goals_confirmed: "目標を確定",
	submitted: "一次評価を依頼",
	first_evaluated: "一次評価を確定",
	finalized: "評価を確定",
};

// details は DB の各関数が書いた JSON。型は信用せず、読めない値は無いものとして扱う
const text = (value: unknown): string | null =>
	typeof value === "string" && value !== "" ? value : null;
const id = (value: unknown): number | null =>
	typeof value === "number" && Number.isInteger(value) ? value : null;
const count = (value: unknown): number | null => (Array.isArray(value) ? value.length : id(value));
const record = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

const isStatus = (value: unknown): value is EvaluationStatusValue =>
	(EVALUATION_STATUS_VALUES as readonly unknown[]).includes(value);
const statusName = (value: unknown): string =>
	isStatus(value) ? EvaluationStatus.from(value).label() : String(value ?? "-");

const personRef = (person: AuditPerson | undefined): AuditPersonRef | null =>
	person ? { name: person.name, employeeNo: person.employeeNo } : null;

type FieldFormat = (value: unknown, directory: AuditDirectory) => string;
const personName: FieldFormat = (value, directory) => {
	const employeeId = id(value);
	if (employeeId === null) {
		return "未設定";
	}
	return directory.people.get(employeeId)?.name ?? `社員 ID ${employeeId}`;
};
const plain = (value: unknown): string =>
	value === null || value === undefined || value === "" ? "未設定" : String(value);

/** 社員マスタの列。並びは画面に出す順。 */
const EMPLOYEE_FIELDS: Record<string, { label: string; format: FieldFormat }> = {
	role_id: {
		label: "権限",
		format: (value, directory) => directory.roles.get(id(value) ?? -1) ?? plain(value),
	},
	primary_evaluator_id: { label: "一次評価者", format: personName },
	secondary_evaluator_id: { label: "二次評価者", format: personName },
	no_secondary_evaluator: {
		label: "二次評価者の有無",
		format: (value) => (value ? "置かない" : "置く"),
	},
	grade_id: {
		label: "等級",
		format: (value, directory) => directory.grades.get(id(value) ?? -1) ?? plain(value),
	},
	is_enabled: { label: "利用", format: (value) => (value ? "利用中" : "停止中") },
	keep_signed_in: {
		label: "ログイン状態",
		format: (value) => (value ? "保持する" : "閉じたらログアウト"),
	},
	name: { label: "氏名", format: plain },
	employee_no: { label: "社員番号", format: plain },
	career_course: { label: "キャリアコース", format: plain },
};
const FIELD_ORDER = Object.keys(EMPLOYEE_FIELDS);

const unknownValue = (value: unknown): string =>
	value === null || value === undefined
		? "未設定"
		: typeof value === "string"
			? value
			: JSON.stringify(value);

function describeEmployeeUpdate(
	details: Record<string, unknown>,
	targetId: number | null,
	actor: AuditPerson | undefined,
	directory: AuditDirectory,
): Pick<AuditEntryView, "title" | "changes"> {
	const fields = Array.isArray(details.changedFields)
		? details.changedFields.filter((field): field is string => typeof field === "string")
		: [];
	const before = record(details.before);
	const after = record(details.after);
	const changes = fields
		.filter((field) => field !== "user_id")
		.sort((a, b) => {
			const rank = (field: string) =>
				FIELD_ORDER.includes(field) ? FIELD_ORDER.indexOf(field) : FIELD_ORDER.length;
			return rank(a) - rank(b);
		})
		.map((field) => {
			const known = EMPLOYEE_FIELDS[field];
			return known
				? {
						label: known.label,
						before: known.format(before[field], directory),
						after: known.format(after[field], directory),
					}
				: { label: field, before: unknownValue(before[field]), after: unknownValue(after[field]) };
		});

	const has = (field: string) => fields.includes(field);
	let title = "社員の情報を変更";
	if (has("user_id")) {
		// 登録は本人のアカウントが紐付け、取り消しは Admin が行う(自分の登録は取り消せない)
		title = actor && actor.id !== targetId ? "登録を取り消し" : "アカウントを登録";
	} else if (has("is_enabled")) {
		title = after.is_enabled ? "利用を再開" : "利用を停止";
	} else if (has("role_id")) {
		title = "権限を変更";
	} else if (
		has("primary_evaluator_id") ||
		has("secondary_evaluator_id") ||
		has("no_secondary_evaluator")
	) {
		title = "評価者を変更";
	} else if (has("grade_id")) {
		title = "等級を変更";
	} else if (has("keep_signed_in")) {
		title = "ログイン状態の保持を変更";
	}
	return { title, changes };
}

function stepTitle(from: unknown, to: unknown): string {
	if (!isStatus(to)) {
		return "状態を変更";
	}
	const order = (value: EvaluationStatusValue) => EVALUATION_STATUS_VALUES.indexOf(value);
	// 一次評価者の通常の差し戻し。下書きへのほかの戻し方は、遡及処理の状態変更だけ
	if (to === "draft" && from === "goals_submitted") {
		return "目標を要修正として戻す";
	}
	if (isStatus(from) && order(to) < order(from) && to !== "draft") {
		return `${EvaluationStatus.from(to).label()}に戻す`;
	}
	return STEP_TITLES[to];
}

const counted = (label: string, value: unknown, unit = "件") => {
	const n = count(value);
	return n === null ? [] : [{ label, value: `${n}${unit}` }];
};

function dayAndTime(occurredAt: string, timeZone?: string) {
	const date = new Date(occurredAt);
	if (Number.isNaN(date.getTime())) {
		return { day: "", time: "" };
	}
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-CA", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		})
			.formatToParts(date)
			.map((part) => [part.type, part.value]),
	);
	return {
		day: `${parts.year}-${parts.month}-${parts.day}`,
		time: `${parts.hour}:${parts.minute}`,
	};
}

/** 記録 1 件を、誰が・いつ・何に・何をしたかの文にする。timeZone を省くと端末の地域。 */
export function describeAuditRecord(
	entry: AuditLogRecord,
	directory: AuditDirectory,
	timeZone?: string,
): AuditEntryView {
	const details = record(entry.details);
	const category = auditCategoryOf(entry.action);
	const accountOwner = entry.actorUserId ? directory.accounts.get(entry.actorUserId) : undefined;
	const actorPerson = accountOwner ?? directory.people.get(id(details.actorEmployeeId) ?? -1);
	const actor: AuditPersonRef = entry.actorUserId
		? (personRef(actorPerson) ?? { name: "不明なアカウント", employeeNo: null })
		: { name: "システム", employeeNo: null };

	const view: AuditEntryView = {
		id: entry.id,
		occurredAt: entry.occurredAt,
		...dayAndTime(entry.occurredAt, timeZone),
		category,
		title: entry.action,
		seal: SEALS[entry.action] ?? null,
		actor,
		subject: null,
		changes: [],
		facts: [],
		reason: text(details.reason),
		raw: JSON.stringify(entry.details ?? {}, null, 2),
	};

	if (entry.action.startsWith("employee.")) {
		view.subject = {
			person: personRef(directory.people.get(entry.entityId ?? -1)),
			periodName: null,
			sheetId: null,
			missing: directory.people.has(entry.entityId ?? -1) ? null : `社員 ID ${entry.entityId}`,
		};
	} else if (entry.action.startsWith("sheet.")) {
		const sheet = directory.sheets.get(entry.entityId ?? -1);
		const employeeId = sheet?.employeeId ?? id(details.employeeId);
		const periodId = sheet?.periodId ?? id(details.periodId);
		const person = personRef(directory.people.get(employeeId ?? -1));
		const periodName = sheet?.periodName ?? directory.periods.get(periodId ?? -1) ?? null;
		view.subject = {
			person,
			periodName,
			sheetId: sheet ? (entry.entityId as number) : null,
			missing: person || periodName ? null : `削除されたシート（ID ${entry.entityId}）`,
		};
	} else if (entry.action.startsWith("period.")) {
		view.subject = {
			person: null,
			periodName: text(details.periodName) ?? directory.periods.get(entry.entityId ?? -1) ?? null,
			sheetId: null,
			missing: null,
		};
	} else if (entry.action === "sheets.imported") {
		view.subject = {
			person: null,
			periodName: text(details.periodName) ?? directory.periods.get(entry.entityId ?? -1) ?? null,
			sheetId: null,
			missing: null,
		};
	}

	switch (entry.action) {
		case "employee.invited":
			view.title = "招待コードを発行";
			break;
		case "employee.pre_registered":
			view.title = "社員を事前登録";
			break;
		case "employee.updated":
			Object.assign(view, describeEmployeeUpdate(details, entry.entityId, actorPerson, directory));
			break;
		case "sheet.status":
			view.title = stepTitle(details.from, details.to);
			view.changes = [
				{ label: "状態", before: statusName(details.from), after: statusName(details.to) },
			];
			break;
		case "sheet.privileged_status":
			view.title = "状態を特権で変更";
			view.changes = [
				{ label: "状態", before: statusName(details.from), after: statusName(details.to) },
			];
			break;
		case "sheet.privileged_delete": {
			view.title = "シートを削除";
			const snapshot = record(details.snapshot);
			view.facts = [
				...counted("削除した目標", snapshot.goals),
				...counted("削除した共通評価", snapshot.commonResults),
				...counted("削除した締め後修正", snapshot.corrections),
			];
			break;
		}
		case "sheet.grade_change":
			view.title = "作成時の等級を変更";
			view.changes = [
				{
					label: "等級",
					before: directory.grades.get(id(details.fromGradeId) ?? -1) ?? "未設定",
					after: directory.grades.get(id(details.toGradeId) ?? -1) ?? "未設定",
				},
			];
			view.facts = counted("削除した共通評価の入力", details.deletedCommonResults);
			break;
		case "sheet.corrected":
			view.title = "締め後修正";
			view.facts = counted("直した項目", details.changes);
			break;
		case "period.closed":
			view.title = "評価期間を締めた";
			view.facts = [
				...counted("評価確定のシート", details.finalizedSheets),
				// 未確定のまま締められるのは、Admin がその期間に認めたときだけ
				...((count(details.unfinishedSheets) ?? 0) > 0
					? counted("未確定のまま締めたシート", details.unfinishedSheets)
					: []),
			];
			break;
		case "period.started":
			view.title = "評価期間を開始した";
			break;
		case "grade.saved": {
			const before = record(details.before);
			const after = record(details.after);
			if (!details.before) {
				view.title = "等級を追加";
				view.facts = [
					{ label: "等級", value: plain(after.name) },
					{ label: "共通目標", value: plain(after.itemSetName) },
				];
				break;
			}
			view.title = "等級を変更";
			view.changes = [
				{ label: "等級名", before: plain(before.name), after: plain(after.name) },
				{ label: "共通目標", before: plain(before.itemSetName), after: plain(after.itemSetName) },
			].filter((change) => change.before !== change.after);
			break;
		}
		case "grade.deleted":
			view.title = "等級を削除";
			view.facts = [{ label: "等級", value: plain(record(details.deleted).name) }];
			break;
		case "common_goals.saved": {
			const before = record(details.before);
			const after = record(details.after);
			view.title = !details.before
				? "共通目標を追加"
				: id(details.previousItemSetId) !== null
					? "共通目標を新しい版で保存"
					: "共通目標を変更";
			if (details.before && id(details.previousItemSetId) === null && before.name !== after.name) {
				view.changes = [{ label: "名前", before: plain(before.name), after: plain(after.name) }];
			}
			view.facts = [
				{ label: "共通目標", value: plain(after.name) },
				...counted("項目", after.items),
				...counted("前の版のままのシート", details.copiedForSheets),
			];
			break;
		}
		case "common_goals.deleted": {
			const deleted = record(details.deleted);
			view.title = "共通目標を削除";
			view.facts = [
				{ label: "共通目標", value: plain(deleted.name) },
				...counted("削除した項目", deleted.items),
			];
			break;
		}
		case "sheets.imported":
			view.title = "評価データを取込";
			view.facts = [
				...counted("社員", details.employees, "人"),
				...counted("新しいシート", details.newSheets),
				...counted("置き換えたシート", details.replacedSheets),
				...counted("目標", details.goals),
				...counted("共通評価", details.commonResults),
			];
			break;
	}
	return view;
}

const dayLabel = new Intl.DateTimeFormat("ja-JP", {
	timeZone: "UTC",
	year: "numeric",
	month: "long",
	day: "numeric",
});
const weekday = new Intl.DateTimeFormat("ja-JP", { timeZone: "UTC", weekday: "short" });

/** 日ごとにまとめる。並びは受け取った順(新しい順)のまま。 */
export function groupByDay(
	entries: readonly AuditEntryView[],
): { day: string; label: string; entries: AuditEntryView[] }[] {
	const days: { day: string; label: string; entries: AuditEntryView[] }[] = [];
	for (const entry of entries) {
		const last = days[days.length - 1];
		if (last?.day === entry.day) {
			last.entries.push(entry);
			continue;
		}
		// day はすでにその地域の日付なので、UTC の真夜中として読めば曜日がずれない
		const date = new Date(`${entry.day}T00:00:00Z`);
		days.push({
			day: entry.day,
			label: Number.isNaN(date.getTime())
				? entry.day
				: `${dayLabel.format(date)}（${weekday.format(date)}）`,
			entries: [entry],
		});
	}
	return days;
}
