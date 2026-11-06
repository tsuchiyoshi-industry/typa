import type {
	CommonGoalSet,
	CommonGoalSetChange,
	GradeChange,
	GradeEntry,
	GradeMaster,
} from "../entities/GradeMaster";

/**
 * 等級と共通目標のマスタ。Admin 以外・利用停止中の Admin は DB が断る。
 * 書き込みはどれも、画面に出していた内容と DB の今の内容が食い違えば断られ、監査ログと同じトランザクションで行う。
 */
export interface GradeMasterRepository {
	load(): Promise<GradeMaster>;
	/** 保存した等級の ID。 */
	saveGrade(change: GradeChange): Promise<number>;
	/** shown は画面に出していた等級(名前が食い違えば断られる)。 */
	deleteGrade(shown: GradeEntry): Promise<void>;
	/** 保存したセットの ID。既存のシートが使うセットの項目を変えたときは、新版の ID。 */
	saveCommonGoalSet(change: CommonGoalSetChange): Promise<number>;
	deleteCommonGoalSet(shown: CommonGoalSet): Promise<void>;
}
