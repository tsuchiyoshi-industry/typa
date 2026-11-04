import { expect, it } from "vitest";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import { EvaluationAllocation } from "../../domain/valueObjects/EvaluationAllocation";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import { sheet } from "../../test/fixtures";
import {
	nextStep,
	notices,
	rankBands,
	scoreExample,
	WRITABLE_ROWS,
	type WritableRow,
} from "./helpGuide";

// fixtures の社員は、本人 1・一次評価者 2・二次評価者 3
const VIEWER = { subject: 1, primary: 2, secondary: 3 } as const;
const POLICY: Record<string, (policy: EvaluationSheetAccessPolicy) => boolean> = {
	目標の文言を書く: (p) => p.canEditMilestoneGoal(),
	達成状況を書く: (p) => p.canEditMilestoneAchievement(),
	シートを読む: (p) => p.canViewSheet(),
	"目標を確定・差し戻す": (p) => p.canConfirmGoals(),
	一次評価を付ける: (p) => p.canEditMilestoneFirstScore(),
	二次評価を付ける: (p) => p.canEditMilestoneSecondScore(),
};

it.each(WRITABLE_ROWS.map((row) => [`${row.actor} ${row.label}`, row] as [string, WritableRow]))(
	"draws %s exactly when the access policy allows it, in every state",
	(_name, row) => {
		const decide = POLICY[row.label];
		expect(decide, row.label).toBeDefined();
		for (const status of EvaluationStatus.ALL) {
			const policy = EvaluationSheetAccessPolicy.for(VIEWER[row.actor], sheet(status));
			expect(row.allowed(status), `${row.label} / ${status.label()}`).toBe(decide(policy));
		}
	},
);

it("never offers the person evaluated their own scores, even once the sheet is finalized", () => {
	const policy = EvaluationSheetAccessPolicy.for(VIEWER.subject, sheet(EvaluationStatus.FINALIZED));
	expect(policy.canViewMilestoneFirstScore()).toBe(false);
	expect(WRITABLE_ROWS.some((row) => row.actor === "subject" && row.label.includes("点数"))).toBe(
		false,
	);
});

it("names the next step for every state but the last", () => {
	expect(nextStep(EvaluationStatus.DRAFT)).toEqual({ by: "subject", action: "目標を送信する" });
	expect(nextStep(EvaluationStatus.FIRST_EVALUATED)).toEqual({
		by: "secondary",
		action: "二次評価を確定する",
	});
	expect(nextStep(EvaluationStatus.FINALIZED)).toBeUndefined();
});

it("notifies on every handoff and never on the final confirmation", () => {
	const list = notices();
	expect(list.map((notice) => notice.status)).not.toContain(EvaluationStatus.FINALIZED);
	expect(list).toContainEqual(
		expect.objectContaining({ from: "subject", to: "primary", action: "目標を送信する" }),
	);
});

it("works the score example from the allocation, rounding after weighting", () => {
	expect(scoreExample(EvaluationAllocation.DEFAULT)).toEqual({
		objective: 20,
		common: 68,
		total: 88,
		rank: "B+",
	});
	// 70 × 17/20 = 59.5 → 60
	expect(scoreExample({ objective: 30, common: 70 })).toMatchObject({ total: 90, rank: "A" });
});

it("covers 0 to 100 points with rank bands that touch", () => {
	const bands = rankBands();
	expect(bands[0]).toMatchObject({ rank: "D", minimum: 0 });
	expect(bands[bands.length - 1]).toMatchObject({ rank: "S", upper: 100 });
	for (let i = 1; i < bands.length; i++) {
		expect(bands[i].minimum).toBe(bands[i - 1].upper);
	}
});
