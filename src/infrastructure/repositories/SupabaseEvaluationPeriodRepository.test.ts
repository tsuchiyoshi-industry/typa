import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("../db/supabase", () => ({ supabase: { from: db.from, rpc: db.rpc } }));

import { EvaluationPeriodPlan } from "../../domain/entities/EvaluationPeriodPlan";
import { expectOk } from "../../domain/Result";
import { CalendarDate } from "../../domain/valueObjects/CalendarDate";
import { DateRange } from "../../domain/valueObjects/DateRange";
import { PeriodDivision } from "../../domain/valueObjects/PeriodDivision";
import { PeriodPart } from "../../domain/valueObjects/PeriodPart";
import { TermName } from "../../domain/valueObjects/TermName";
import { SupabaseEvaluationPeriodRepository } from "./SupabaseEvaluationPeriodRepository";

type Result = { data: unknown; error: unknown };
const ok = (data: unknown): Result => ({ data, error: null });
const failed: Result = { data: null, error: { message: "network" } };

/** PostgREST のクエリビルダーの代わり。呼ばれた操作を記録し、await すると result になる。 */
function query(result: Result) {
	const calls: [string, unknown[]][] = [];
	const builder = Promise.resolve(result) as Promise<Result> & Record<string, unknown>;
	for (const name of ["select", "order", "eq", "insert", "update", "delete"]) {
		builder[name] = (...args: unknown[]) => {
			calls.push([name, args]);
			return builder;
		};
	}
	builder.maybeSingle = () => Promise.resolve(result);
	db.from.mockReturnValue(builder);
	return calls;
}
const row = {
	id: 3,
	period_name: "26期 下期",
	term_name: "26期",
	division: "half",
	part: 2,
	start_date: "2026-10-01",
	end_date: "2027-03-31",
	is_active: false,
	closed_at: "2027-04-01T00:00:00Z",
	allow_unfinalized_close: true,
};
const describeError = () => "invalid";
const plan = new EvaluationPeriodPlan(
	expectOk(TermName.from("27期"), describeError),
	PeriodPart.of(PeriodDivision.HALF, 1),
	expectOk(
		DateRange.of(
			expectOk(CalendarDate.parse("2027-04-01"), describeError),
			expectOk(CalendarDate.parse("2027-09-30"), describeError),
		),
		describeError,
	),
	false,
);

beforeEach(() => {
	db.from.mockReset();
	db.rpc.mockReset();
	vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reading evaluation periods", () => {
	it("reads every period newest first, knowing which are closed", async () => {
		const calls = query(ok([row]));
		const [period] = await new SupabaseEvaluationPeriodRepository().findDistinctPeriods();
		expect(period).toMatchObject({
			id: 3,
			periodName: "26期 下期",
			isActive: false,
			isClosed: true,
			allowUnfinalizedClose: true,
		});
		expect(calls).toContainEqual(["order", ["start_date", { ascending: false }]]);
	});

	it("finds one period, and nothing for a period that does not exist", async () => {
		query(ok(row));
		expect((await new SupabaseEvaluationPeriodRepository().findById(3))?.periodName).toBe(
			"26期 下期",
		);
		query(ok(null));
		expect(await new SupabaseEvaluationPeriodRepository().findById(999)).toBeNull();
	});

	// 読めなかったことを「評価期間が無い」「見つからない」と見せない
	it.each([
		[
			"the list",
			(repository: SupabaseEvaluationPeriodRepository) => repository.findDistinctPeriods(),
		],
		["one period", (repository: SupabaseEvaluationPeriodRepository) => repository.findById(3)],
	])("fails when %s cannot be read", async (_label, read) => {
		query(failed);
		await expect(read(new SupabaseEvaluationPeriodRepository())).rejects.toThrow("network");
	});

	it("counts the sheets of a period by status, and fails instead of counting none", async () => {
		db.rpc.mockResolvedValue(ok({ draft: 2, finalized: 3 }));
		const counts = await new SupabaseEvaluationPeriodRepository().countSheetsByStatus(3);
		expect([counts.total(), counts.unfinished()]).toEqual([5, 2]);
		expect(db.rpc).toHaveBeenCalledWith("get_evaluation_period_sheet_counts", { p_period_id: 3 });
		db.rpc.mockResolvedValue(failed);
		await expect(new SupabaseEvaluationPeriodRepository().countSheetsByStatus(3)).rejects.toThrow();
	});
});

describe("changing evaluation periods", () => {
	it("adds periods with which part of the term they are, and changes only names, dates and closing", async () => {
		const added = query(ok([{ id: 4 }]));
		expect(await new SupabaseEvaluationPeriodRepository().create([plan])).toBe(true);
		expect(added).toContainEqual([
			"insert",
			[
				[
					{
						period_name: "27期 上期",
						term_name: "27期",
						start_date: "2027-04-01",
						end_date: "2027-09-30",
						allow_unfinalized_close: false,
						division: "half",
						part: 1,
					},
				],
			],
		]);
		const updated = query(ok([{ id: 4 }]));
		expect(await new SupabaseEvaluationPeriodRepository().update(4, plan)).toBe(true);
		// どの区切りか(division / part)は、作った後は変えない
		expect(updated.find(([name]) => name === "update")?.[1][0]).not.toHaveProperty("division");
		expect(updated).toContainEqual(["eq", ["id", 4]]);
	});

	it.each([
		["refused by the row policy (no row changed)", ok([])],
		["failed", failed],
	])("reports a change that was %s as not done", async (_label, result) => {
		const repository = new SupabaseEvaluationPeriodRepository();
		query(result);
		expect(await repository.create([plan])).toBe(false);
		query(result);
		expect(await repository.update(4, plan)).toBe(false);
		query(result);
		expect(await repository.delete(4)).toBe(false);
	});

	it("closes a period only through the audited database function", async () => {
		db.rpc.mockResolvedValue(ok(true));
		expect(await new SupabaseEvaluationPeriodRepository().activate(4)).toBe(true);
		expect(db.rpc).toHaveBeenCalledWith("activate_evaluation_period", { p_period_id: 4 });
		db.rpc.mockResolvedValue(failed);
		expect(await new SupabaseEvaluationPeriodRepository().activate(4)).toBe(false);
	});
});
