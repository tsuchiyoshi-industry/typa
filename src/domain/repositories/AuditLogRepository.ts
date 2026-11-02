/** 監査ログの記録 1 件。details の中身は action ごとに違う(DB の各関数・トリガーが決める)。 */
export interface AuditLogRecord {
	id: number;
	/** ISO 8601 */
	occurredAt: string;
	/** 操作したアカウント(Auth のユーザー)。DB の内部処理なら null。 */
	actorUserId: string | null;
	action: string;
	/** 社員の記録なら社員 ID、シートの記録ならシート ID、取込なら評価期間の ID。 */
	entityId: number | null;
	details: Record<string, unknown>;
}

/** 絞り込み。指定しないものは絞らない。 */
export interface AuditLogFilter {
	actions?: readonly string[];
	/** この時刻以降(含む)・この時刻より前(含まない)。ISO 8601 */
	since?: string;
	until?: string;
	actorUserId?: string;
	/** その社員の記録(社員としての変更と、その社員のシートの記録)。sheetIds はその社員のシート。 */
	target?: { employeeId: number; sheetIds: readonly number[] };
}

export interface AuditLogPage {
	/** 新しい順 */
	records: AuditLogRecord[];
	/** これより前の記録がまだあるか */
	hasMore: boolean;
}

/** 記録の操作者・対象を名前で示すための社員。登録を取り消した社員の userId は null。 */
export interface AuditPerson {
	id: number;
	userId: string | null;
	name: string;
	employeeNo: string;
}

/** Admin だけが読める(DB の行ポリシー)。ほかの人が読むと、記録は 0 件になる。 */
export interface AuditLogRepository {
	/** before: 前のページの最後の ID。null なら最新から。 */
	findPage(filter: AuditLogFilter, before: number | null, limit: number): Promise<AuditLogPage>;
	findPeople(): Promise<AuditPerson[]>;
	/** 権限の ID と名前(社員の変更の記録は role_id で残る)。 */
	findRoleNames(): Promise<Map<number, string>>;
}
