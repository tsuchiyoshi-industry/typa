import type { SheetGradeChange } from "../entities/SheetGradeChange";

/** シートの作成時の等級を変える。共通評価の削除・等級の変更・監査記録は DB の同一トランザクションで行う。 */
export interface SheetGradeRepository {
	/** 消した共通評価の入力の件数を返す。 */
	execute(change: SheetGradeChange): Promise<number>;
}
