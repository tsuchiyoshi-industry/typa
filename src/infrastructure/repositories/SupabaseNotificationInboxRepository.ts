import type {
	InAppNotification,
	NotificationInboxRepository,
} from "../../domain/repositories/NotificationInboxRepository";
import { supabase } from "../db/supabase";

/** 一覧に出す件数。古い通知は、評価シートの一覧から辿れる。 */
const LIMIT = 50;

interface NotificationRow {
	id: number;
	sheet_id: number;
	kind: InAppNotification["kind"];
	employee_name: string;
	period_name: string;
	created_at: string;
	read_at: string | null;
}

export class SupabaseNotificationInboxRepository implements NotificationInboxRepository {
	async findMine(): Promise<InAppNotification[]> {
		const { data, error } = await supabase
			.from("notifications")
			.select("id, sheet_id, kind, employee_name, period_name, created_at, read_at")
			.order("created_at", { ascending: false })
			.limit(LIMIT);
		if (error) {
			throw error;
		}
		return ((data ?? []) as NotificationRow[]).map((row) => ({
			id: row.id,
			sheetId: row.sheet_id,
			kind: row.kind,
			employeeName: row.employee_name,
			periodName: row.period_name,
			createdAt: row.created_at,
			read: row.read_at !== null,
		}));
	}

	async markRead(ids: readonly number[]): Promise<void> {
		if (ids.length === 0) {
			return;
		}
		const { error } = await supabase
			.from("notifications")
			.update({ read_at: new Date().toISOString() })
			.in("id", [...ids]);
		if (error) {
			throw error;
		}
	}

	async markAllRead(): Promise<void> {
		// 宛先の本人の通知だけが更新される(DB の行ポリシー)
		const { error } = await supabase
			.from("notifications")
			.update({ read_at: new Date().toISOString() })
			.is("read_at", null);
		if (error) {
			throw error;
		}
	}
}
