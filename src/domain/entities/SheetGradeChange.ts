import { err, ok, type Result } from "../Result";
import { EvaluationStatus, type EvaluationStatusValue } from "../valueObjects/EvaluationStatus";
import type { PeriodStateValue } from "../valueObjects/PeriodState";
import { charLength } from "../valueObjects/textLength";

export interface SheetGradeChangeRequest {
	sheetId: number;
	gradeId: number | null;
	/** 画面に出していた今の等級と状態。確かめている間に変わっていたら DB が断る。 */
	expectedGradeId: number | null;
	expectedStatus: string;
	reason: string;
}

export type SheetGradeChangeError =
	| { kind: "forbidden" }
	| { kind: "invalidSheetId" }
	| { kind: "gradeRequired" }
	| { kind: "sameGrade" }
	| { kind: "invalidStatus" }
	| { kind: "firstEvaluationConfirmed" }
	| { kind: "reasonInvalid" };

/**
 * 業務のきまり: シートの作成時の等級を変えられるのは、当期(実施中の評価期間)のシートで、一次評価が確定する前だけ。
 * 確定した後に変えると、確定した評価点・ランクの元になった共通評価が消えてしまう(先に状態を戻す)。
 */
export const canChangeSheetGrade = (status: EvaluationStatus, period: PeriodStateValue): boolean =>
	period === "active" && !status.isFirstEvaluationConfirmed();

const isId = (value: number | null): value is number =>
	value !== null && Number.isSafeInteger(value) && value > 0;

/**
 * シートの作成時の等級の変更。等級で変わるのは共通評価の項目だけなので、そのシートの共通評価の入力
 * (点数・コメント)はすべて消える。目標・点数・総評には影響しない。取り消せない。
 */
export class SheetGradeChange {
	private constructor(
		readonly sheetId: number,
		readonly gradeId: number,
		readonly expectedGradeId: number | null,
		readonly expectedStatus: EvaluationStatusValue,
		readonly reason: string,
	) {}

	static from(request: SheetGradeChangeRequest): Result<SheetGradeChange, SheetGradeChangeError> {
		if (!isId(request.sheetId)) {
			return err({ kind: "invalidSheetId" });
		}
		if (!isId(request.gradeId)) {
			return err({ kind: "gradeRequired" });
		}
		if (request.gradeId === request.expectedGradeId) {
			return err({ kind: "sameGrade" });
		}
		const status = EvaluationStatus.find(request.expectedStatus);
		if (!status) {
			return err({ kind: "invalidStatus" });
		}
		if (status.isFirstEvaluationConfirmed()) {
			return err({ kind: "firstEvaluationConfirmed" });
		}
		const reason = request.reason.trim();
		if (!reason || charLength(reason) > 500) {
			return err({ kind: "reasonInvalid" });
		}
		return ok(
			new SheetGradeChange(
				request.sheetId,
				request.gradeId,
				request.expectedGradeId,
				status.toString(),
				reason,
			),
		);
	}
}
