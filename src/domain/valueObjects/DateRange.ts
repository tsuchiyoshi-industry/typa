import { DomainError } from "../DomainError";
import type { CalendarDate } from "./CalendarDate";

/** 開始日から終了日まで(両端を含む)。終了日が開始日より前にはならない。 */
export class DateRange {
	private constructor(
		readonly start: CalendarDate,
		readonly end: CalendarDate,
	) {}

	static of(start: CalendarDate, end: CalendarDate): DateRange {
		if (end.isBefore(start)) {
			throw new DomainError("終了日は開始日以降の日付にしてください。");
		}
		return new DateRange(start, end);
	}

	/** other が始まる前に、この期間が終わっている(1日でも重なれば false)。 */
	endsBefore(other: DateRange): boolean {
		return this.end.isBefore(other.start);
	}

	equals(other: DateRange): boolean {
		return this.start.equals(other.start) && this.end.equals(other.end);
	}
}
