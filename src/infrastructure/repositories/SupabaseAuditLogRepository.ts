import type {
	AuditLogFilter,
	AuditLogPage,
	AuditLogRepository,
	AuditPerson,
} from "../../domain/repositories/AuditLogRepository";
import { supabase } from "../db/supabase";

/** 1 回に読む件数の上限。削除の記録はシートの中身を丸ごと持つので、大きくしない。 */
const MAX_LIMIT = 200;

interface AuditRow {
	id: number;
	occurred_at: string;
	actor_user_id: string | null;
	action: string;
	entity_id: number | null;
	details: Record<string, unknown> | null;
}

/**
 * その社員の記録: 社員としての変更、その社員のシートの記録、削除・等級変更などで details に社員 ID を残した記録。
 * 削除されたシートの以前の状態遷移は、シートの ID がもう分からないので含まれない。
 */
function targetClause({ employeeId, sheetIds }: NonNullable<AuditLogFilter["target"]>): string {
	return [
		`and(action.like.employee.*,entity_id.eq.${employeeId})`,
		...(sheetIds.length > 0
			? [`and(action.like.sheet.*,entity_id.in.(${sheetIds.join(",")}))`]
			: []),
		`details->>employeeId.eq.${employeeId}`,
	].join(",");
}

export class SupabaseAuditLogRepository implements AuditLogRepository {
	async findPage(
		filter: AuditLogFilter,
		before: number | null,
		limit: number,
	): Promise<AuditLogPage> {
		if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
			throw new RangeError(`limit must be an integer from 1 to ${MAX_LIMIT}`);
		}
		// 1 件多く読み、まだ前があるかを知る(件数を数える問い合わせを別に送らない)
		let request = supabase
			.from("security_audit_log")
			.select("id, occurred_at, actor_user_id, action, entity_id, details")
			.order("id", { ascending: false })
			.limit(limit + 1);
		if (before !== null) {
			request = request.lt("id", before);
		}
		if (filter.actions?.length) {
			request = request.in("action", [...filter.actions]);
		}
		if (filter.since) {
			request = request.gte("occurred_at", filter.since);
		}
		if (filter.until) {
			request = request.lt("occurred_at", filter.until);
		}
		if (filter.actorUserId) {
			request = request.eq("actor_user_id", filter.actorUserId);
		}
		if (filter.target) {
			request = request.or(targetClause(filter.target));
		}
		const { data, error } = await request;
		if (error) {
			throw error;
		}
		const rows = (data ?? []) as AuditRow[];
		return {
			hasMore: rows.length > limit,
			records: rows.slice(0, limit).map((row) => ({
				id: row.id,
				occurredAt: row.occurred_at,
				actorUserId: row.actor_user_id,
				action: row.action,
				entityId: row.entity_id,
				details: row.details ?? {},
			})),
		};
	}

	async findPeople(): Promise<AuditPerson[]> {
		// 誰のアカウントか(user_id)は表から読めない。employee_details が Admin にだけ返す
		const [people, details] = await Promise.all([
			supabase.from("employees").select("id, name, employee_no"),
			supabase.rpc("employee_details"),
		]);
		for (const result of [people, details]) {
			if (result.error) {
				throw result.error;
			}
		}
		const userIds = new Map(
			((details.data ?? []) as { employee_id: number; user_id: string | null }[]).map((row) => [
				row.employee_id,
				row.user_id,
			]),
		);
		return ((people.data ?? []) as { id: number; name: string; employee_no: string }[]).map(
			(row) => ({
				id: row.id,
				userId: userIds.get(row.id) ?? null,
				name: row.name,
				employeeNo: row.employee_no,
			}),
		);
	}

	async findRoleNames(): Promise<Map<number, string>> {
		const { data, error } = await supabase.from("roles").select("id, role_name");
		if (error) {
			throw error;
		}
		return new Map(
			((data ?? []) as { id: number; role_name: string }[]).map((row) => [row.id, row.role_name]),
		);
	}
}
