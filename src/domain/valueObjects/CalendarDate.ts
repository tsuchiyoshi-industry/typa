import type { PeriodError } from "../entities/PeriodError";
import { err, ok, type Result } from "../Result";

const DAY_MS = 86_400_000;

/**
 * 暦の上の日付(YYYY-MM-DD)。時刻もタイムゾーンも持たないので、どこで動かしても日がずれない。
 * 評価期間の開始日・終了日に使う。
 */
export class CalendarDate {
	/** 1970-01-01 からの日数。比べるときと日を足すときに使う。 */
	private readonly epochDay: number;

	private constructor(
		readonly year: number,
		/** 1〜12 */
		readonly month: number,
		readonly day: number,
	) {
		this.epochDay = Date.UTC(year, month - 1, day) / DAY_MS;
	}

	/** YYYY-MM-DD の、実在する日付だけを受け付ける(2026-02-30 や 2026-4-1、1900 年より前は不可)。 */
	static parse(value: string): Result<CalendarDate, PeriodError> {
		const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
		if (match) {
			const [year, month, day] = match.slice(1).map(Number);
			if (
				year >= 1900 &&
				month >= 1 &&
				month <= 12 &&
				day >= 1 &&
				day <= daysInMonth(year, month)
			) {
				return ok(new CalendarDate(year, month, day));
			}
		}
		return err({ kind: "dateInvalid" });
	}

	/** months か月後(負なら前)の同じ日。その月にない日(8/31 の半年後など)は、その月の末日にする。 */
	addMonths(months: number): CalendarDate {
		const index = this.year * 12 + (this.month - 1) + months;
		const year = Math.floor(index / 12);
		const month = (index % 12) + 1;
		return new CalendarDate(year, month, Math.min(this.day, daysInMonth(year, month)));
	}

	previousDay(): CalendarDate {
		const date = new Date((this.epochDay - 1) * DAY_MS);
		return new CalendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
	}

	/** this が other より前なら負、同じ日なら 0、後なら正。 */
	compare(other: CalendarDate): number {
		return this.epochDay - other.epochDay;
	}

	isBefore(other: CalendarDate): boolean {
		return this.compare(other) < 0;
	}

	equals(other: CalendarDate): boolean {
		return this.compare(other) === 0;
	}

	toString(): string {
		const pad = (value: number, length: number) => String(value).padStart(length, "0");
		return `${pad(this.year, 4)}-${pad(this.month, 2)}-${pad(this.day, 2)}`;
	}
}

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
