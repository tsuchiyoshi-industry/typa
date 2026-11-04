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
	/** 期の名前・日付・締め方だけを変える。実施中かどうかは close と activate でしか変わらない。変更できたら true。 */
	update(periodId: number, plan: EvaluationPeriodPlan): Promise<boolean>;
	/** 実施中の期間と、評価シートのある期間はDB側で拒否される。削除できたら true。 */
	delete(periodId: number): Promise<boolean>;
	/**
	 * 締め: 実施中の評価期間を締める。次の評価期間は開始せず、準備中になる。
	 * Admin だけが実行できるDB関数で、監査に記録する。締めたら true。
	 */
	close(periodId: number): Promise<boolean>;
	/**
	 * 開始: 準備中の評価期間を実施中にする。実施中の評価期間がある間は開始しない(先に close で締める)。
	 * Admin だけが実行できるDB関数で、監査に記録する。開始したら true。
	 */
	activate(periodId: number): Promise<boolean>;
	/** その期間の評価シートの、状態ごとの枚数。Admin だけが読める。 */
	countSheetsByStatus(periodId: number): Promise<SheetCountsByStatus>;
}
