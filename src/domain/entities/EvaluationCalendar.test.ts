import { describe, expect, it } from "vitest";
import { expectOk } from "../Result";
import { CalendarDate } from "../valueObjects/CalendarDate";
import { DateRange } from "../valueObjects/DateRange";
import { SheetCountsByStatus } from "../valueObjects/SheetCountsByStatus";
import { TermName } from "../valueObjects/TermName";
import { EvaluationCalendar } from "./EvaluationCalendar";
import { EvaluationPeriod } from "./EvaluationPeriod";
import { describePeriodError } from "./PeriodError";

const date = (value: string) => expectOk(CalendarDate.parse(value), describePeriodError);
const termName = (value: string) => expectOk(TermName.from(value), describePeriodError);
const range = (start: string, end: string) =>
	expectOk(DateRange.of(date(start), date(end)), describePeriodError);

let nextId = 1;
const period = (
	termName: string,
	division: "full" | "half" | "quarter",
	part: number,
	startDate: string,
	endDate: string,
	options: {
		isActive?: boolean;
		isClosed?: boolean;
		allowUnfinalizedClose?: boolean;
		id?: number;
	} = {},
) =>
	EvaluationPeriod.restore({
		id: options.id ?? nextId++,
		termName,
		division,
		part,
		startDate,
		endDate,
		isActive: options.isActive ?? false,
		isClosed: options.isClosed,
		allowUnfinalizedClose: options.allowUnfinalizedClose,
	});
const names = (periods: readonly EvaluationPeriod[]) => periods.map((p) => p.periodName);

// 25期は通年(締め済み)、26期は半期制(上期は締め済み、下期が実施中)、27期は四半期制(まだ始めていない)
const term25 = period("25期", "full", 1, "2025-04-01", "2026-03-31", { isClosed: true });
const first26 = period("26期", "half", 1, "2026-04-01", "2026-09-30", { isClosed: true });
const second26 = period("26期", "half", 2, "2026-10-01", "2027-03-31", { isActive: true });
const quarters27 = [1, 2, 3, 4].map((part) =>
	period(
		"27期",
		"quarter",
		part,
		["2027-04-01", "2027-07-01", "2027-10-01", "2028-01-01"][part - 1],
		["2027-06-30", "2027-09-30", "2027-12-31", "2028-03-31"][part - 1],
	),
);
const calendar = new EvaluationCalendar([first26, ...quarters27, term25, second26]);

describe("evaluation period", () => {
	it("is named after its term and part, and knows which term it belongs to", () => {
		expect(names([term25, first26, second26, quarters27[2]])).toEqual([
			"25期",
			"26期 上期",
			"26期 下期",
			"27期 第3四半期",
		]);
		expect(first26.isInSameTermAs(second26)).toBe(true);
		expect(first26.isInSameTermAs(term25)).toBe(false);
		expect([first26.startDate, first26.endDate]).toEqual(["2026-04-01", "2026-09-30"]);
	});

	it.each([
		["a part the division does not have", { division: "half", part: 3 }],
		["an unknown division", { division: "monthly", part: 1 }],
		["a date that does not exist", { startDate: "2026-02-30" }],
		["an end before the start", { startDate: "2026-10-01", endDate: "2026-09-30" }],
		["a blank term name", { termName: " " }],
	])("cannot be restored from %s", (_label, override) => {
		expect(() =>
			EvaluationPeriod.restore({
				id: 1,
				termName: "26期",
				division: "half",
				part: 1,
				startDate: "2026-04-01",
				endDate: "2026-09-30",
				isActive: false,
				...override,
			}),
		).toThrow();
	});

	it("can be started only before it has ever started (a closed period is never reopened)", () => {
		expect(quarters27[0].startable()).toEqual({ ok: true, value: undefined });
		expect(second26.startable()).toEqual({
			ok: false,
			error: { kind: "alreadyActive", periodName: "26期 下期" },
		});
		expect(term25.startable()).toEqual({
			ok: false,
			error: { kind: "alreadyClosed", periodName: "25期" },
		});
		expect(first26.startable()).toEqual({
			ok: false,
			error: { kind: "alreadyClosed", periodName: "26期 上期" },
		});
		expect([term25, second26, quarters27[0]].map((p) => p.state.label)).toEqual([
			"締め済み",
			"実施中",
			"未開始",
		]);
	});

	it("cannot be restored as both in progress and closed", () => {
		expect(() =>
			EvaluationPeriod.restore({
				id: 1,
				termName: "26期",
				startDate: "2026-04-01",
				endDate: "2027-03-31",
				isActive: true,
				isClosed: true,
			}),
		).toThrow();
	});

	it("closes only with every sheet finalized, unless the Admin allowed otherwise", () => {
		const unfinished = SheetCountsByStatus.from({ draft: 2, submitted: 1, finalized: 7 });
		expect(second26.closable(SheetCountsByStatus.from({ finalized: 9 }))).toEqual({
			ok: true,
			value: undefined,
		});
		expect(second26.closable(SheetCountsByStatus.NONE)).toEqual({ ok: true, value: undefined });
		expect(second26.closable(unfinished)).toMatchObject({
			ok: false,
			error: {
				kind: "unfinishedSheets",
				periodName: "26期 下期",
				count: 3,
				detail: "下書き 2 件・一次評価待ち 1 件",
			},
		});
		const loose = period("26期", "half", 1, "2026-04-01", "2026-09-30", {
			isActive: true,
			allowUnfinalizedClose: true,
		});
		expect(loose.closable(unfinished)).toEqual({ ok: true, value: undefined });
	});

	it("can be deleted only when it is not in progress and has no sheets", () => {
		expect(first26.deletable(SheetCountsByStatus.NONE)).toEqual({ ok: true, value: undefined });
		expect(quarters27[0].deletable(SheetCountsByStatus.NONE)).toEqual({
			ok: true,
			value: undefined,
		});
		expect(second26.deletable(SheetCountsByStatus.NONE)).toEqual({
			ok: false,
			error: { kind: "activeCannotBeDeleted" },
		});
		expect(first26.deletable(SheetCountsByStatus.from({ finalized: 1 }))).toEqual({
			ok: false,
			error: { kind: "hasSheets", periodName: "26期 上期", count: 1 },
		});
	});

	it("lets unfinalized sheets be exported only after a period that allows it is closed", () => {
		const state = (isActive: boolean, isClosed: boolean, allowUnfinalizedClose: boolean) =>
			period("26期", "half", 1, "2026-04-01", "2026-09-30", {
				isActive,
				isClosed,
				allowUnfinalizedClose,
			}).allowsExportBeforeFinalized();
		expect(state(false, true, true)).toBe(true);
		// 実施中・未開始のうちは、認めた期間でも確定したシートだけ
		expect(state(true, false, true)).toBe(false);
		expect(state(false, false, true)).toBe(false);
		expect(state(false, true, false)).toBe(false);
	});

	it("keeps which part it is when its term name, dates or closing rule change", () => {
		const plan = second26.replan({
			term: termName("第26期"),
			range: range("2026-10-01", "2027-03-20"),
			allowUnfinalizedClose: true,
		});
		expect([plan.periodName, plan.part.equals(second26.part), plan.allowUnfinalizedClose]).toEqual([
			"第26期 下期",
			true,
			true,
		]);
	});
});

describe("evaluation calendar", () => {
	it("lists periods newest first and finds the one in progress", () => {
		expect(names(calendar.all())).toEqual([
			"27期 第4四半期",
			"27期 第3四半期",
			"27期 第2四半期",
			"27期 第1四半期",
			"26期 下期",
			"26期 上期",
			"25期",
		]);
		expect(calendar.active()).toBe(second26);
		expect(calendar.find(first26.id)).toBe(first26);
		expect(calendar.find(-1)).toBeNull();
	});

	it("groups the divided periods of a term", () => {
		expect(names(calendar.termOf(second26))).toEqual(["26期 上期", "26期 下期"]);
		expect(names(calendar.termOf(quarters27[0]))).toEqual([
			"27期 第1四半期",
			"27期 第2四半期",
			"27期 第3四半期",
			"27期 第4四半期",
		]);
		expect(names(calendar.termOf(term25))).toEqual(["25期"]);
	});

	it.each([
		["the second half follows the first half of the same term", second26, "26期 上期"],
		["the first half follows the previous full-year term", first26, "25期"],
		["the first quarter follows the second half of the previous term", quarters27[0], "26期 下期"],
		["a later quarter follows the quarter before it", quarters27[2], "27期 第2四半期"],
	])("knows the previous period: %s", (_label, current, previous) => {
		expect(calendar.previousOf(current)?.periodName).toBe(previous);
	});

	it("has nothing in progress and no previous period when there are no periods", () => {
		const empty = new EvaluationCalendar([]);
		expect([empty.all(), empty.active(), empty.find(1)]).toEqual([[], null, null]);
		expect(empty.hasPeriodNamed("26期")).toBe(false);
	});

	it("has no previous period before the first one", () => {
		expect(calendar.previousOf(term25)).toBeNull();
		expect(new EvaluationCalendar([first26]).previousOf(first26)).toBeNull();
	});

	it("looks further back when the period just before is missing", () => {
		// 26期の下期を消した(作らなかった)ときの27期第1四半期の前は、26期の上期
		const withoutSecondHalf = new EvaluationCalendar([term25, first26, ...quarters27]);
		expect(withoutSecondHalf.previousOf(quarters27[0])?.periodName).toBe("26期 上期");
		// あいだに評価期間の無い時期があっても、その前の評価期間
		const gap = period("29期", "full", 1, "2029-04-01", "2030-03-31");
		expect(new EvaluationCalendar([term25, gap]).previousOf(gap)?.periodName).toBe("25期");
	});

	it("does not count a period that is still running when the next one starts", () => {
		// 移行前の通年の期と、分けた評価期間が重なっていても、前は終わったものから選ぶ
		const legacy = period("26期(旧)", "full", 1, "2026-04-01", "2027-03-20");
		const overlapping = new EvaluationCalendar([term25, legacy, first26, second26]);
		expect(overlapping.previousOf(second26)?.periodName).toBe("26期 上期");
		expect(overlapping.previousOf(first26)?.periodName).toBe("25期");
	});

	it("breaks ties between periods that end on the same day by start date, then by id", () => {
		const longer = period("A", "full", 1, "2026-01-01", "2026-09-30", { id: 100 });
		const shorter = period("B", "full", 1, "2026-07-01", "2026-09-30", { id: 101 });
		const sameAsShorter = period("C", "full", 1, "2026-07-01", "2026-09-30", { id: 102 });
		const next = period("D", "full", 1, "2026-10-01", "2027-03-31", { id: 103 });
		expect(new EvaluationCalendar([longer, shorter, next]).previousOf(next)?.periodName).toBe("B");
		expect(
			new EvaluationCalendar([sameAsShorter, longer, shorter, next]).previousOf(next)?.periodName,
		).toBe("C");
	});

	it("knows which names are already taken, apart from the period being renamed", () => {
		expect(calendar.hasPeriodNamed("26期 上期")).toBe(true);
		expect(calendar.hasPeriodNamed("26期 上期", first26.id)).toBe(false);
		expect(calendar.hasPeriodNamed("28期")).toBe(false);
	});
});
