import { fc, it } from "@fast-check/vitest";
import { describe, expect } from "vitest";
import { blank, calendarDateText, textBetween } from "../../test/arbitraries";
import { describePeriodError } from "../entities/PeriodError";
import { expectOk } from "../Result";
import { CalendarDate } from "./CalendarDate";
import { DateRange } from "./DateRange";
import {
	EVALUATION_STATUS_VALUES,
	EvaluationStatus,
	type EvaluationStatusValue,
} from "./EvaluationStatus";
import { PeriodDivision } from "./PeriodDivision";
import { PeriodPart } from "./PeriodPart";
import { PERIOD_STATE_VALUES, PeriodState } from "./PeriodState";
import { SheetCountsByStatus } from "./SheetCountsByStatus";
import { TermName } from "./TermName";

const date = (value: string) => expectOk(CalendarDate.parse(value), describePeriodError);
const termName = (value: string) => expectOk(TermName.from(value), describePeriodError);
const division = (value: string) => expectOk(PeriodDivision.from(value), describePeriodError);

// 比べる相手は JavaScript の Date(UTC)。CalendarDate とは別の作りで、同じ答えになるかを見る
const DAY_MS = 86_400_000;
const utc = (text: string) => Date.parse(`${text}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const pad = (value: number, length = 2) => String(value).padStart(length, "0");
const INVALID = { ok: false, error: { kind: "dateInvalid" } };

describe("CalendarDate", () => {
	it.prop([calendarDateText], {
		examples: [["2028-02-29"], ["1900-01-01"], ["9999-12-31"]],
	})("accepts any real date and writes it back the same", (text) => {
		expect(date(text).toString()).toBe(text);
	});

	it.prop(
		[
			fc.integer({ min: 1900, max: 9999 }),
			fc.integer({ min: 0, max: 13 }),
			fc.integer({ min: 0, max: 39 }),
		],
		{
			examples: [
				[2026, 2, 29],
				[2026, 4, 31],
				[2026, 13, 1],
				[2026, 0, 10],
				[2026, 4, 0],
			],
		},
	)("accepts a year, month and day only when the day exists", (year, month, day) => {
		const exists = month >= 1 && month <= 12 && day >= 1 && day <= lastDay(year, month);
		const parsed = CalendarDate.parse(`${year}-${pad(month)}-${pad(day)}`);
		expect(parsed.ok).toBe(exists);
		if (!exists) {
			expect(parsed).toMatchObject(INVALID);
		}
	});

	it.prop([fc.integer({ min: 0, max: 1899 }), calendarDateText])(
		"rejects a year before 1900",
		(year, text) => {
			expect(CalendarDate.parse(`${pad(year, 4)}${text.slice(4)}`)).toMatchObject(INVALID);
		},
	);

	// ゼロ埋めのない値・前後の空白・時刻つき・空・英字
	it.prop([fc.string().filter((value) => !/^\d{4}-\d{2}-\d{2}$/.test(value))], {
		examples: [["2026-4-1"], [" 2026-04-01"], ["2026-04-01T00:00"], [""], ["abcd-ef-gh"]],
	})("rejects anything not written as YYYY-MM-DD", (value) => {
		expect(CalendarDate.parse(value)).toMatchObject(INVALID);
	});

	const within = fc
		.date({
			min: new Date(Date.UTC(1950, 0, 1)),
			max: new Date(Date.UTC(9900, 11, 31)),
			noInvalidDate: true,
		})
		.map((value) => value.toISOString().slice(0, 10));
	it.prop([within, fc.integer({ min: -600, max: 600 })], {
		// その月にない日は、その月の末日。前にも戻れる
		examples: [
			["2026-01-31", 1],
			["2028-01-31", 1],
			["2026-08-31", 6],
			["2028-02-29", 12],
			["2026-03-31", -1],
			["2026-04-01", 0],
		],
	})(
		"moves by whole months, and to the month's last day when the day does not exist",
		(text, months) => {
			const from = date(text);
			const moved = from.addMonths(months);
			expect(moved.year * 12 + moved.month - (from.year * 12 + from.month)).toBe(months);
			expect(moved.day).toBe(Math.min(from.day, lastDay(moved.year, moved.month)));
			expect(moved.toString()).toBe(`${pad(moved.year, 4)}-${pad(moved.month)}-${pad(moved.day)}`);
		},
	);

	it.prop([within, fc.integer({ min: -300, max: 300 }), fc.integer({ min: -300, max: 300 })])(
		"adds months in steps the same as at once when no month end is involved",
		(text, a, b) => {
			const start = date(`${text.slice(0, 8)}${pad(Math.min(Number(text.slice(8)), 28))}`);
			expect(start.addMonths(a).addMonths(b)).toEqual(start.addMonths(a + b));
		},
	);

	it.prop([calendarDateText.filter((text) => text !== "1900-01-01")], {
		examples: [["2026-03-01"], ["2028-03-01"], ["2027-01-01"]],
	})("goes back exactly one day", (text) => {
		const previous = date(text).previousDay();
		expect(previous.toString()).toBe(fromUtc(utc(text) - DAY_MS));
		expect(date(text).compare(previous)).toBe(1);
	});

	// YYYY-MM-DD は、文字の順と暦の順が同じになる
	it.prop([calendarDateText, calendarDateText])(
		"orders dates by the calendar and counts the days between them",
		(a, b) => {
			expect(date(a).compare(date(b))).toBe((utc(a) - utc(b)) / DAY_MS);
			expect(date(a).isBefore(date(b))).toBe(a < b);
			expect(date(a).compare(date(b)) + date(b).compare(date(a))).toBe(0);
		},
	);
});

describe("DateRange", () => {
	it.prop([calendarDateText, calendarDateText], { examples: [["2026-04-01", "2026-04-01"]] })(
		"allows any range whose end is not before its start, a single day included",
		(start, end) => {
			const range = DateRange.of(date(start), date(end));
			if (end < start) {
				expect(range).toMatchObject({ ok: false, error: { kind: "rangeReversed" } });
			} else {
				expect(expectOk(range, describePeriodError).end.toString()).toBe(end);
			}
		},
	);
});

describe("TermName", () => {
	it.prop([blank, textBetween(1, TermName.MAX_LENGTH), blank], { examples: [["  ", "26期", " "]] })(
		"keeps the name without the spaces around it",
		(before, name, after) => {
			expect(termName(`${before}${name}${after}`).toString()).toBe(name);
		},
	);

	it.prop([blank])("rejects a blank name", (value) => {
		expect(TermName.from(value)).toMatchObject({ ok: false, error: { kind: "termNameMissing" } });
	});

	// 上限そのものは textLength.test.ts で確かめる。ここでは理由の種類を見る
	it.prop([textBetween(TermName.MAX_LENGTH + 1, TermName.MAX_LENGTH + 20)])(
		"says the name is too long when it is",
		(name) => {
			expect(TermName.from(name)).toMatchObject({
				ok: false,
				error: { kind: "termNameTooLong", max: TermName.MAX_LENGTH },
			});
		},
	);
});

describe("PeriodDivision and PeriodPart", () => {
	it("divides a term of 12 months into 1, 2 or 4 periods", () => {
		expect(
			PeriodDivision.ALL.map((division) => [
				division.toString(),
				division.parts,
				division.monthsPerPart,
			]),
		).toEqual([
			["full", 1, 12],
			["half", 2, 6],
			["quarter", 4, 3],
		]);
		expect(division("half")).toBe(PeriodDivision.HALF);
	});

	// 大文字・前後の空白も知らない値(勝手に通年や半期として扱わない)
	it.prop([fc.string().filter((value) => !["full", "half", "quarter"].includes(value))], {
		examples: [[""], ["monthly"], ["HALF"], ["full "]],
	})("rejects an unknown division", (value) => {
		expect(PeriodDivision.from(value)).toMatchObject({
			ok: false,
			error: { kind: "divisionUnknown" },
		});
	});

	it("names each part the way the company says it", () => {
		const term = termName("26期");
		expect(PeriodPart.of(PeriodDivision.FULL, 1).nameIn(term)).toBe("26期");
		expect([1, 2].map((n) => PeriodPart.of(PeriodDivision.HALF, n).nameIn(term))).toEqual([
			"26期 上期",
			"26期 下期",
		]);
		expect([1, 2, 3, 4].map((n) => PeriodPart.of(PeriodDivision.QUARTER, n).label)).toEqual([
			"第1四半期",
			"第2四半期",
			"第3四半期",
			"第4四半期",
		]);
	});

	it.prop([fc.constantFrom(...PeriodDivision.ALL), fc.oneof(fc.integer(), fc.double())], {
		examples: [
			[PeriodDivision.FULL, 2],
			[PeriodDivision.HALF, 0],
			[PeriodDivision.QUARTER, 1.5],
		],
	})("has the parts 1 to the number of parts, and no other", (division, number) => {
		if (Number.isInteger(number) && number >= 1 && number <= division.parts) {
			expect(PeriodPart.of(division, number).number).toBe(number);
		} else {
			expect(() => PeriodPart.of(division, number)).toThrow();
		}
	});
});

describe("PeriodState", () => {
	it("moves from not started to active to closed, and is never active and closed at once", () => {
		expect(PeriodState.of(false, false)).toBe(PeriodState.NOT_STARTED);
		expect(PeriodState.of(true, false)).toBe(PeriodState.ACTIVE);
		expect(PeriodState.of(false, true)).toBe(PeriodState.CLOSED);
		expect(
			[PeriodState.NOT_STARTED, PeriodState.ACTIVE, PeriodState.CLOSED].map((state) => [
				state.toString(),
				state.label,
			]),
		).toEqual([
			["not_started", "未開始"],
			["active", "実施中"],
			["closed", "締め済み"],
		]);
		expect(() => PeriodState.of(true, true)).toThrow(
			"実施中の評価期間は、締め済みにはなりません。",
		);
	});

	it("has a preparing state between closing one period and starting the next", () => {
		expect(PeriodState.PREPARING.toString()).toBe("preparing");
		expect(PeriodState.PREPARING.label).toBe("準備中");
		expect(PERIOD_STATE_VALUES).toEqual(["not_started", "preparing", "active", "closed"]);
		// 準備中は保存しない。暦(締めた後に何が実施中でないか)から決まる
		for (const [active, closed] of [
			[false, false],
			[true, false],
			[false, true],
		] as const) {
			expect(PeriodState.of(active, closed)).not.toBe(PeriodState.PREPARING);
		}
	});
});

describe("SheetCountsByStatus", () => {
	it("counts unfinished sheets and says which stages they are in", () => {
		const counts = SheetCountsByStatus.from({ draft: 2, first_evaluated: 1, finalized: 7 });
		expect(counts.total()).toBe(10);
		expect(counts.unfinished()).toBe(3);
		expect(counts.describeUnfinished()).toBe("下書き 2 件・二次評価待ち 1 件");
		expect(SheetCountsByStatus.from({ submitted: 1 }).describeUnfinished()).toBe(
			"一次評価待ち 1 件",
		);
		expect(SheetCountsByStatus.NONE.total()).toBe(0);
		expect(SheetCountsByStatus.from({ finalized: 4 }).describeUnfinished()).toBe("");
	});

	const counts = fc.record(
		Object.fromEntries(EVALUATION_STATUS_VALUES.map((status) => [status, fc.nat(1000)])) as Record<
			EvaluationStatusValue,
			fc.Arbitrary<number>
		>,
		{ requiredKeys: [] },
	);
	it.prop([counts])(
		"adds up every stage, and leaves only finalized sheets out of the unfinished",
		(given) => {
			const sheets = SheetCountsByStatus.from(given);
			const of = (status: EvaluationStatusValue) => given[status] ?? 0;
			expect(sheets.total()).toBe(
				EVALUATION_STATUS_VALUES.reduce((sum, status) => sum + of(status), 0),
			);
			expect(sheets.unfinished()).toBe(sheets.total() - of("finalized"));
			// 説明に出るのは、確定していない段階のうち 1 件以上あるものだけ
			const described = sheets.describeUnfinished();
			for (const status of EvaluationStatus.ALL) {
				const mentioned = described.includes(`${status.label()} `);
				expect(mentioned).toBe(!status.isFinalized() && of(status.toString()) > 0);
			}
		},
	);

	it.prop(
		[
			fc.constantFrom(...EVALUATION_STATUS_VALUES),
			fc.oneof(
				fc.integer({ max: -1 }),
				fc.double().filter((value) => !Number.isInteger(value)),
			),
		],
		{
			examples: [
				["draft", -1],
				["draft", 1.5],
				["draft", Number.NaN],
			],
		},
	)("rejects a count that is negative or not whole", (status, count) => {
		expect(() => SheetCountsByStatus.from({ [status]: count })).toThrow();
	});
});
