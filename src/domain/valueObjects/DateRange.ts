import type { PeriodError } from "../entities/PeriodError";
import { err, ok, type Result } from "../Result";
import type { CalendarDate } from "./CalendarDate";

/** 開始日から終了日まで(両端を含む)。終了日が開始日より前にはならない。 */
export class DateRange {
	private constructor(
		readonly start: CalendarDate,
		readonly end: CalendarDate,
	) {}

	static of(start: CalendarDate, end: CalendarDate): Result<DateRange, PeriodError> {
		return end.isBefore(start) ? err({ kind: "rangeReversed" }) : ok(new DateRange(start, end));
	}
}
