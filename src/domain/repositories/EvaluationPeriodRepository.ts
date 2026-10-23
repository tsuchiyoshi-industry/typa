import type { EvaluationPeriod } from "../entities/EvaluationPeriod";
import type { EvaluationPeriodPlan } from "../entities/EvaluationPeriodPlan";
import type { SheetCountsByStatus } from "../valueObjects/SheetCountsByStatus";

export interface EvaluationPeriodRepository {
	findDistinctPeriods(): Promise<EvaluationPeriod[]>;
	findById(periodId: number): Promise<EvaluationPeriod | null>;
	/**
	 * まとめて追加する(期を上期・下期などに分けたとき)。すべて追加できるか、何も追加しない。
	 * 追加した期間は、必ず締めた状態(実施中ではない)で始まる。Admin 以外はDB側で拒否される。追加できたら true。
	 */
	create(plans: EvaluationPeriodPlan[]): Promise<boolean>;
	/** 期の名前・日付・締め方だけを変える。実施中かどうかは activate でしか変わらない。変更できたら true。 */
	update(periodId: number, plan: EvaluationPeriodPlan): Promise<boolean>;
	/** 実施中の期間と、評価シートのある期間はDB側で拒否される。削除できたら true。 */
	delete(periodId: number): Promise<boolean>;
	/**
	 * 期間締め: 指定した期間を実施中にし、それまで実施中だった期間を締める(同時に行う)。
	 * Admin だけが実行できるDB関数。切り替えできたら true。
	 */
	activate(periodId: number): Promise<boolean>;
	/** その期間の評価シートの、状態ごとの枚数。Admin だけが読める。 */
	countSheetsByStatus(periodId: number): Promise<SheetCountsByStatus>;
}
