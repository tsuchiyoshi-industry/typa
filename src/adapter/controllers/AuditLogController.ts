import { toEvaluationPeriodDto } from "../../application/dtos/EvaluationPeriodDto";
import { type AuditCategory, auditActionsOf } from "../../domain/entities/AuditEvent";
import type {
	AuditLogFilter,
	AuditLogRepository,
} from "../../domain/repositories/AuditLogRepository";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { EvaluationPeriodRepository } from "../../domain/repositories/EvaluationPeriodRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import { canViewAuditLog } from "../../domain/services/EmployeeMasterAccessService";
import {
	type AuditDirectory,
	type AuditEntryView,
	createAuditDirectory,
	describeAuditRecord,
} from "../viewmodels/auditLog";

/** 1 ページの件数。 */
const PAGE_SIZE = 100;

/** 画面の絞り込み。日付は YYYY-MM-DD(空なら絞らない)で、終わりの日はその日の終わりまで含む。 */
export interface AuditLogQuery {
	category: AuditCategory | "all";
	since: string;
	until: string;
	actorEmployeeId: number | null;
	targetEmployeeId: number | null;
}

export interface AuditPersonOption {
	id: number;
	name: string;
	employeeNo: string;
}

export interface AuditLogPageView {
	entries: AuditEntryView[];
	hasMore: boolean;
	/** 続きを読むときに渡す ID。続きがなければ null。 */
	next: number | null;
}

/** その地域の日付の始まりの時刻(ISO)。日付として読めなければ例外。 */
function startOfDay(value: string, field: string, addDays = 0): string {
	const date = new Date(`${value}T00:00:00`);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime())) {
		throw new Error(`${field}の日付を読み取れません。`);
	}
	date.setDate(date.getDate() + addDays);
	return date.toISOString();
}

/**
 * 監査ログの画面(Admin だけ)。DB が操作と同時に書いた記録を、新しい順に読む。書き込みはしない。
 * 記録の中の ID(社員・シート・等級・権限)は、画面を開いたときに一度だけ読む台帳で名前にする。
 */
export class AuditLogController {
	private directory: AuditDirectory | null = null;
	private sheetsByEmployee = new Map<number, number[]>();

	constructor(
		private readonly employees: Pick<
			EmployeeMasterRepository,
			"findCurrentEmployeeProfile" | "findGrades"
		>,
		private readonly periodRepository: Pick<EvaluationPeriodRepository, "findDistinctPeriods">,
		private readonly sheetRepository: Pick<EvaluationSheetRepository, "findOverviewIndex">,
		private readonly log: AuditLogRepository,
		/** 省くと端末の地域。テストでは固定する。 */
		private readonly timeZone?: string,
	) {}

	/** 絞り込みの候補を返す。Admin でなければ何も読まずに断る(URL を直接開いたときも)。 */
	async open(): Promise<{ targets: AuditPersonOption[]; actors: AuditPersonOption[] }> {
		this.directory = null;
		const actor = await this.employees.findCurrentEmployeeProfile();
		if (!actor?.enabled || !canViewAuditLog(actor.role)) {
			throw new Error("監査ログは Admin のみ利用できます。");
		}
		const [people, roles, grades, periods, index] = await Promise.all([
			this.log.findPeople(),
			this.log.findRoleNames(),
			this.employees.findGrades(),
			this.periodRepository.findDistinctPeriods(),
			this.sheetRepository.findOverviewIndex(),
		]);
		const periodNames = new Map(index.periods.map((period) => [period.id, period.name]));
		const sheets = index.sheets.map((sheet) => ({
			...sheet,
			periodName: periodNames.get(sheet.periodId) ?? "",
		}));
		this.directory = createAuditDirectory({
			people,
			roles,
			grades,
			periods: periods.map(toEvaluationPeriodDto),
			sheets,
		});
		this.sheetsByEmployee = new Map();
		for (const sheet of sheets) {
			this.sheetsByEmployee.set(sheet.employeeId, [
				...(this.sheetsByEmployee.get(sheet.employeeId) ?? []),
				sheet.id,
			]);
		}
		const options = [...people]
			.sort((a, b) => a.employeeNo.localeCompare(b.employeeNo))
			.map(({ id, name, employeeNo, userId }) => ({ option: { id, name, employeeNo }, userId }));
		return {
			targets: options.map(({ option }) => option),
			// アカウントのない社員(未登録・登録の取り消し後)は、操作した人として探せない
			actors: options.filter(({ userId }) => userId).map(({ option }) => option),
		};
	}

	/** before: 前のページの next。null なら最新から。 */
	async page(query: AuditLogQuery, before: number | null): Promise<AuditLogPageView> {
		const directory = this.directory;
		if (!directory) {
			throw new Error("監査ログを開いてから読み込んでください。");
		}
		const filter: AuditLogFilter = {};
		if (query.category !== "all") {
			filter.actions = auditActionsOf(query.category);
		}
		if (query.since) {
			filter.since = startOfDay(query.since, "期間の始まり");
		}
		if (query.until) {
			filter.until = startOfDay(query.until, "期間の終わり", 1);
		}
		if (filter.since && filter.until && filter.since >= filter.until) {
			throw new Error("期間の始まりが、終わりの日より後になっています。");
		}
		if (query.actorEmployeeId !== null) {
			const userId = directory.people.get(query.actorEmployeeId)?.userId;
			if (!userId) {
				throw new Error("操作した人には、アカウントのある社員を選んでください。");
			}
			filter.actorUserId = userId;
		}
		if (query.targetEmployeeId !== null) {
			if (!directory.people.has(query.targetEmployeeId)) {
				throw new Error("対象の社員が見つかりません。画面を開き直してください。");
			}
			filter.target = {
				employeeId: query.targetEmployeeId,
				sheetIds: this.sheetsByEmployee.get(query.targetEmployeeId) ?? [],
			};
		}
		const { records, hasMore } = await this.log.findPage(filter, before, PAGE_SIZE);
		return {
			entries: records.map((record) => describeAuditRecord(record, directory, this.timeZone)),
			hasMore,
			next: hasMore ? (records[records.length - 1]?.id ?? null) : null,
		};
	}
}
