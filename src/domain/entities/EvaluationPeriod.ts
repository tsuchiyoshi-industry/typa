import { err, expectOk, ok, type Result } from "../Result";
import { CalendarDate } from "../valueObjects/CalendarDate";
import { DateRange } from "../valueObjects/DateRange";
import { PeriodDivision } from "../valueObjects/PeriodDivision";
import { PeriodPart } from "../valueObjects/PeriodPart";
import { PeriodState } from "../valueObjects/PeriodState";
import type { SheetCountsByStatus } from "../valueObjects/SheetCountsByStatus";
import { TermName } from "../valueObjects/TermName";
import { EvaluationPeriodPlan } from "./EvaluationPeriodPlan";
import { describePeriodError, type PeriodError } from "./PeriodError";

/**
 * 評価期間。期(年度)を通年のまま、または上期・下期、四半期に分けたものの1つで、
 * 分けた評価期間はそれぞれ独立している(シートを作り、評価し、締める単位)。
 * 同じ期の評価期間をまとめて「当期」などと呼ぶ扱いは EvaluationCalendar が持つ。
 */
export class EvaluationPeriod {
	private constructor(
		readonly id: number,
		readonly term: TermName,
		readonly part: PeriodPart,
		readonly range: DateRange,
		/** 未開始・実施中・締め済み。実施中の評価期間は常に1つ。 */
		readonly state: PeriodState,
		/** 評価が確定していないシートが残っていても締めてよい期間か(Admin が決める)。 */
		readonly allowUnfinalizedClose: boolean,
	) {}

	/** 保存済みの値から作る。区切りを省くと分けていない(通年の)評価期間、isClosed を省くと締めていない評価期間。 */
	static restore(params: {
		id: number;
		termName: string;
		division?: string;
		part?: number;
		startDate: string;
		endDate: string;
		isActive: boolean;
		isClosed?: boolean;
		allowUnfinalizedClose?: boolean;
	}): EvaluationPeriod {
		return new EvaluationPeriod(
			params.id,
			trusted(TermName.from(params.termName)),
			PeriodPart.of(trusted(PeriodDivision.from(params.division ?? "full")), params.part ?? 1),
			trusted(
				DateRange.of(
					trusted(CalendarDate.parse(params.startDate)),
					trusted(CalendarDate.parse(params.endDate)),
				),
			),
			PeriodState.of(params.isActive, params.isClosed ?? false),
			params.allowUnfinalizedClose ?? false,
		);
	}

	/** 「26期」「26期 上期」。 */
	get periodName(): string {
		return this.part.nameIn(this.term);
	}

	/** YYYY-MM-DD。画面と保存に渡すとき用。 */
	get startDate(): string {
		return this.range.start.toString();
	}

	get endDate(): string {
		return this.range.end.toString();
	}

	/** 実施中か。シートの作成・記入・評価・確定は、実施中の評価期間でだけできる。 */
	get isActive(): boolean {
		return this.state === PeriodState.ACTIVE;
	}

	/** 締め済みか。締めた評価期間のシートは誰も変更できず、評価期間をもう一度開始することもできない。 */
	get isClosed(): boolean {
		return this.state === PeriodState.CLOSED;
	}

	/** 同じ期(年度)の評価期間か。上期と下期は同じ期。 */
	isInSameTermAs(other: EvaluationPeriod): boolean {
		return this.term.equals(other.term);
	}

	/** 次に実施する評価期間として開始できるか。開始できるのは未開始の評価期間だけ(締めたものは再開しない)。 */
	startable(): Result<void, PeriodError> {
		if (this.isActive) {
			return err({ kind: "alreadyActive", periodName: this.periodName });
		}
		if (this.isClosed) {
			return err({ kind: "alreadyClosed", periodName: this.periodName });
		}
		return ok(undefined);
	}

	/**
	 * 締められるか。評価が確定していないシートが残っていれば締められない。
	 * ただし Admin が「評価が確定していなくても締められる」とした評価期間は、そのまま締められる。
	 */
	closable(sheets: SheetCountsByStatus): Result<void, PeriodError> {
		return sheets.unfinished() > 0 && !this.allowUnfinalizedClose
			? err({
					kind: "unfinishedSheets",
					periodName: this.periodName,
					count: sheets.unfinished(),
					detail: sheets.describeUnfinished(),
				})
			: ok(undefined);
	}

	/** 削除できるか。実施中の評価期間と、評価シートが1枚でもある評価期間は削除できない。 */
	deletable(sheets: SheetCountsByStatus): Result<void, PeriodError> {
		if (this.isActive) {
			return err({ kind: "activeCannotBeDeleted" });
		}
		if (sheets.total() > 0) {
			return err({ kind: "hasSheets", periodName: this.periodName, count: sheets.total() });
		}
		return ok(undefined);
	}

	/**
	 * 遡及処理(締め後修正)を受け付けるか。締めた評価期間のシートだけを、評価期間を開き直さずに直す。
	 * 実施中・未開始の評価期間のシートは、ふだんの記入と評価で直す。
	 */
	allowsRetroactiveCorrection(): boolean {
		return this.isClosed;
	}

	/**
	 * 評価が確定していないシートも PDF に出力できるか。評価を確定せずに締めてよい評価期間を、
	 * 締めた後だけ(点数とランクは伏せる)。実施中の間は、確定したシートだけを出力できる。
	 */
	allowsExportBeforeFinalized(): boolean {
		return this.isClosed && this.allowUnfinalizedClose;
	}

	/** 期の名前・日付・締め方を変えた内容。どの区切りか(上期など)は変えない。 */
	replan(changes: {
		term: TermName;
		range: DateRange;
		allowUnfinalizedClose: boolean;
	}): EvaluationPeriodPlan {
		return new EvaluationPeriodPlan(
			changes.term,
			this.part,
			changes.range,
			changes.allowUnfinalizedClose,
		);
	}

	equals(other: EvaluationPeriod): boolean {
		return this.id === other.id;
	}
}

/** 保存済みの評価期間の値。きまりに反していればデータの不整合として例外にする。 */
const trusted = <T>(result: Result<T, PeriodError>): T => expectOk(result, describePeriodError);
