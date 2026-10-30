import { describe, expect, it } from "vitest";
import { describePeriodError } from "../entities/PeriodError";
import { expectOk } from "../Result";
import { CalendarDate } from "./CalendarDate";
import { DateRange } from "./DateRange";
import { PeriodDivision } from "./PeriodDivision";
import { PeriodPart } from "./PeriodPart";
import { PeriodState } from "./PeriodState";
import { SheetCountsByStatus } from "./SheetCountsByStatus";
import { TermName } from "./TermName";

const date = (value: string) => expectOk(CalendarDate.parse(value), describePeriodError);
const termName = (value: string) => expectOk(TermName.from(value), describePeriodError);
const division = (value: string) => expectOk(PeriodDivision.from(value), describePeriodError);

describe("CalendarDate", () => {
	it.each(["2026-04-01", "2028-02-29", "2026-12-31", "1900-01-01", "9999-12-31"])(
		"accepts %s and writes it back the same",
		(value) => expect(date(value).toString()).toBe(value),
	);

	it.each([
		["a day that does not exist", "2026-02-29"],
		["the 31st of a 30-day month", "2026-04-31"],
		["month 13", "2026-13-01"],
		["month 0", "2026-00-10"],
		["day 0", "2026-04-00"],
		["missing zero padding", "2026-4-1"],
		["surrounding spaces", " 2026-04-01"],
		["a time", "2026-04-01T00:00"],
		["an empty value", ""],
		["letters", "abcd-ef-gh"],
		["a year before 1900", "1899-12-31"],
	])("rejects %s (%s)", (_label, value) => {
		expect(CalendarDate.parse(value)).toMatchObject({
			ok: false,
			error: { kind: "dateInvalid" },
		});
	});

	it.each([
		["2026-03-23", 6, "2026-09-23"],
		["2026-11-15", 3, "2027-02-15"],
		// その月にない日は、その月の末日
		["2026-01-31", 1, "2026-02-28"],
		["2028-01-31", 1, "2028-02-29"],
		["2026-08-31", 6, "2027-02-28"],
		["2026-05-31", 1, "2026-06-30"],
		["2028-02-29", 12, "2029-02-28"],
		// 前にも戻れる
		["2026-03-31", -1, "2026-02-28"],
		["2026-01-15", -1, "2025-12-15"],
		["2026-04-01", 0, "2026-04-01"],
	])("moves %s by %i months to %s", (from, months, to) => {
		expect(date(from).addMonths(months).toString()).toBe(to);
	});

	it.each([
		["2026-03-01", "2026-02-28"],
		["2028-03-01", "2028-02-29"],
		["2027-01-01", "2026-12-31"],
		["2026-04-02", "2026-04-01"],
	])("goes back from %s to %s", (from, to) => {
		expect(date(from).previousDay().toString()).toBe(to);
	});

	it("orders dates by the calendar, not by the text", () => {
		expect(date("2026-04-01").isBefore(date("2026-04-02"))).toBe(true);
		expect(date("2026-12-31").isBefore(date("2027-01-01"))).toBe(true);
		expect(date("2027-01-01").isBefore(date("2026-12-31"))).toBe(false);
		expect(date("2026-04-01").isBefore(date("2026-04-01"))).toBe(false);
		expect(date("2026-04-01").compare(date("2026-03-31"))).toBe(1);
		expect(date("2026-01-01").compare(date("2025-01-01"))).toBe(365);
	});
});

describe("DateRange", () => {
	it("allows a single day and rejects an end before the start", () => {
		expect(
			expectOk(
				DateRange.of(date("2026-04-01"), date("2026-04-01")),
				describePeriodError,
			).end.toString(),
		).toBe("2026-04-01");
		expect(DateRange.of(date("2026-04-02"), date("2026-04-01"))).toMatchObject({
			ok: false,
			error: { kind: "rangeReversed" },
		});
	});
});

describe("TermName", () => {
	it("trims the name", () => {
		expect(termName("  26期 ").toString()).toBe("26期");
	});

	it.each(["", "   ", "\t"])("rejects a blank name %j", (value) => {
		expect(TermName.from(value)).toMatchObject({ ok: false, error: { kind: "termNameMissing" } });
	});

	it("rejects a name longer than 40 characters", () => {
		expect(termName("期".repeat(40)).toString()).toHaveLength(40);
		expect(TermName.from("期".repeat(41))).toMatchObject({
			ok: false,
			error: { kind: "termNameTooLong", max: 40 },
		});
	});
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

	it.each(["", "monthly", "HALF", "full "])("rejects unknown division %j", (value) => {
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

	it.each([
		[PeriodDivision.FULL, 2],
		[PeriodDivision.HALF, 0],
		[PeriodDivision.HALF, 3],
		[PeriodDivision.QUARTER, 5],
		[PeriodDivision.QUARTER, 1.5],
	])("rejects a part the division does not have (%s, %d)", (division, number) => {
		expect(() => PeriodPart.of(division, number)).toThrow();
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

	it.each([-1, 1.5, Number.NaN])("rejects a count of %d", (count) => {
		expect(() => SheetCountsByStatus.from({ draft: count })).toThrow();
	});
});
