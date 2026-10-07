import type { EvaluationAllocation } from "../valueObjects/EvaluationAllocation";

/** Admin が「設定」で決める、会社ごとの評価の基準。 */
export interface EvaluationSettingsRepository {
	findAllocation(): Promise<EvaluationAllocation>;
	/** Admin 以外の保存はDB側で拒否される。保存できたら true。 */
	saveAllocation(allocation: EvaluationAllocation): Promise<boolean>;
}
