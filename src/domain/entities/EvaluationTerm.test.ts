import { describe, expect, it } from "vitest";
import { expectOk } from "../Result";
import { CalendarDate } from "../valueObjects/CalendarDate";
import { DateRange } from "../valueObjects/DateRange";
import { PeriodDivision } from "../valueObjects/PeriodDivision";
import { TermName } from "../valueObjects/TermName";
import { EvaluationTerm } from "./EvaluationTerm";
import { describePeriodError } from "./PeriodError";

const date = (value: string) => expectOk(CalendarDate.parse(value), describePeriodError);
const term = (start: string, end: string, division: PeriodDivision, name = "26期") =>
	expectOk(
		EvaluationTerm.of(
			expectOk(TermName.from(name), describePeriodError),
			expectOk(DateRange.of(date(start), date(end)), describePeriodError),
			division,
		),
		describePeriodError,
	);
const periods = (start: string, end: string, division: PeriodDivision) =>
	term(start, end, division)
		.divide(false)
		.map((plan) => [plan.periodName, plan.range.start.toString(), plan.range.end.toString()]);

describe("dividing a term into evaluation periods", () => {
	it("keeps a full-year term as one period named after the term", () => {
		expect(periods("2026-04-01", "2027-03-31", PeriodDivision.FULL)).toEqual([
			["26期", "2026-04-01", "2027-03-31"],
		]);
	});

	it("splits an April fiscal year at the end of September", () => {
		expect(periods("2026-04-01", "2027-03-31", PeriodDivision.HALF)).toEqual([
			["26期 上期", "2026-04-01", "2026-09-30"],
			["26期 下期", "2026-10-01", "2027-03-31"],
		]);
	});

	it("follows a fiscal year that starts mid-month, so nobody has to look up the boundary", () => {
		expect(periods("2026-03-23", "2027-03-22", PeriodDivision.HALF)).toEqual([
			["26期 上期", "2026-03-23", "2026-09-22"],
			["26期 下期", "2026-09-23", "2027-03-22"],
		]);
	});

	it("splits into calendar quarters", () => {
		expect(periods("2026-04-01", "2027-03-31", PeriodDivision.QUARTER)).toEqual([
			["26期 第1四半期", "2026-04-01", "2026-06-30"],
			["26期 第2四半期", "2026-07-01", "2026-09-30"],
			["26期 第3四半期", "2026-10-01", "2026-12-31"],
			["26期 第4四半期", "2027-01-01", "2027-03-31"],
		]);
	});

	it("cuts at the end of a month that has no such day, including a leap February", () => {
		expect(periods("2027-08-31", "2028-08-30", PeriodDivision.QUARTER)).toEqual([
			["26期 第1四半期", "2027-08-31", "2027-11-29"],
			["26期 第2四半期", "2027-11-30", "2028-02-28"],
			["26期 第3四半期", "2028-02-29", "2028-05-30"],
			["26期 第4四半期", "2028-05-31", "2028-08-30"],
		]);
		expect(periods("2026-08-31", "2027-08-30", PeriodDivision.HALF)).toEqual([
			["26期 上期", "2026-08-31", "2027-02-27"],
			["26期 下期", "2027-02-28", "2027-08-30"],
		]);
	});

	it("gives the last period whatever remains when the term is not exactly a year", () => {
		expect(periods("2026-04-01", "2027-09-30", PeriodDivision.HALF)).toEqual([
			["26期 上期", "2026-04-01", "2026-09-30"],
			["26期 下期", "2026-10-01", "2027-09-30"],
		]);
		// 1日だけでも、空でなければ分けられる
		expect(periods("2026-04-01", "2026-10-01", PeriodDivision.HALF)).toEqual([
			["26期 上期", "2026-04-01", "2026-09-30"],
			["26期 下期", "2026-10-01", "2026-10-01"],
		]);
	});

	it.each([
		[PeriodDivision.HALF, "2026-09-30", "半期(上期・下期)"],
		[PeriodDivision.QUARTER, "2026-09-30", "四半期"],
		[PeriodDivision.QUARTER, "2026-12-31", "四半期"],
	])("refuses to leave an empty period (%s until %s)", (division, end, expectedDivision) => {
		const result = EvaluationTerm.of(
			expectOk(TermName.from("26期"), describePeriodError),
			expectOk(DateRange.of(date("2026-04-01"), date(end)), describePeriodError),
			division,
		);
		expect(result).toMatchObject({
			ok: false,
			error: { kind: "termTooShort", division: expectedDivision },
		});
	});

	it("passes how the periods may be closed on to every period", () => {
		const plans = term("2026-04-01", "2027-03-31", PeriodDivision.HALF).divide(true);
		expect(plans.map((plan) => plan.allowUnfinalizedClose)).toEqual([true, true]);
		expect(plans.map((plan) => plan.part.number)).toEqual([1, 2]);
		expect(plans.map((plan) => plan.term.toString())).toEqual(["26期", "26期"]);
	});

	it("covers the whole term without gaps or overlaps, whatever day it starts on", () => {
		// 2028 年(うるう年)の毎日を開始日にして、1年の期を分ける
		for (let day = 0; day < 366; day++) {
			const start = date(new Date(Date.UTC(2028, 0, 1 + day)).toISOString().slice(0, 10));
			const end = start.addMonths(12).previousDay();
			for (const division of PeriodDivision.ALL) {
				const ranges = term(start.toString(), end.toString(), division)
					.divide(false)
					.map((plan) => plan.range);
				expect(ranges).toHaveLength(division.parts);
				expect(ranges[0].start.compare(start)).toBe(0);
				expect(ranges[ranges.length - 1].end.compare(end)).toBe(0);
				ranges.forEach((range, i) => {
					expect(range.end.isBefore(range.start)).toBe(false);
					// 前の評価期間の翌日から始まる
					if (i > 0) {
						expect(range.start.previousDay().compare(ranges[i - 1].end)).toBe(0);
					}
				});
			}
		}
	});
});
