/**
 * 監査ログ(security_audit_log)の記録の種類。記録は DB が操作と同じトランザクションで書き、アプリは読むだけ。
 * account: 社員・アカウント / workflow: 評価の進行 / override: Admin が通常の手順を越えた操作(遡及処理) /
 * import: データの取込。
 */
export const AUDIT_CATEGORIES = ["account", "workflow", "override", "import"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

const ACTIONS: Record<AuditCategory, readonly string[]> = {
	account: ["employee.invited", "employee.pre_registered", "employee.updated"],
	workflow: ["sheet.status"],
	override: [
		"sheet.corrected",
		"sheet.privileged_status",
		"sheet.privileged_delete",
		"sheet.grade_change",
	],
	import: ["sheets.imported"],
};

export const KNOWN_AUDIT_ACTIONS: readonly string[] = AUDIT_CATEGORIES.flatMap((c) => ACTIONS[c]);

export const auditActionsOf = (category: AuditCategory): readonly string[] => ACTIONS[category];

/** 知らない action(新しい DB と古いアプリの組み合わせ)は other。隠さずに原文のまま見せる。 */
export const auditCategoryOf = (action: string): AuditCategory | "other" =>
	AUDIT_CATEGORIES.find((category) => ACTIONS[category].includes(action)) ?? "other";

/** 検印を押す記録。Admin が理由を添えて、通常の承認や締めを越えて行った操作。 */
export const isAuditOverride = (action: string): boolean => auditCategoryOf(action) === "override";
