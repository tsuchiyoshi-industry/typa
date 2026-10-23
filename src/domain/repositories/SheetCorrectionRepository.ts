import type { EvaluationSheet } from "../entities/EvaluationSheet";
import type { RetroactiveCorrection } from "../entities/RetroactiveCorrection";

/** 遡及処理(締め後修正)。どちらも Admin だけが呼べ、締めた評価期間のシートだけが対象(DB 関数も確かめる)。 */
export interface SheetCorrectionRepository {
	/** 締めた評価期間のシートを、点数・コメント・修正の記録まですべて読む。 */
	findClosedSheet(sheetId: number): Promise<EvaluationSheet>;
	/** 直して、直した内容を消えない記録として残す。すべて直すか、何も直さない。直した項目の数。 */
	record(correction: RetroactiveCorrection): Promise<number>;
}
