import { describe, expect, it } from "vitest";
import type { PreviousGoals } from "../repositories/MilestoneRepository";
import { continuityOf } from "./GoalContinuity";

const previous: PreviousGoals = {
	periodName: "2027年度 上期",
	goals: [
		{
			id: 1,
			goalNumber: 1,
			challengeGoal: "受注の手戻りを減らす",
			periodGoals: [],
			achievement: "",
			carriedInto: 1,
		},
		{
			id: 2,
			goalNumber: 2,
			challengeGoal: "後進を育てる",
			periodGoals: [],
			achievement: "",
			carriedInto: 3,
		},
		{
			id: 3,
			goalNumber: 3,
			challengeGoal: "済んだ目標",
			periodGoals: [],
			achievement: "",
			carriedInto: null,
		},
	],
};

describe("continuity of a challenge goal from the previous period", () => {
	it("keeps a carried goal whose wording is unchanged, ignoring surrounding spaces", () => {
		expect(continuityOf(1, " 受注の手戻りを減らす\n", previous)).toEqual({
			kind: "kept",
			periodName: "2027年度 上期",
			previous: { goalNumber: 1, challengeGoal: "受注の手戻りを減らす" },
		});
	});

	it("calls a carried goal with new wording revised, and remembers the old wording", () => {
		expect(continuityOf(3, "後進を育て、任せる", previous)).toMatchObject({
			kind: "revised",
			previous: { goalNumber: 2, challengeGoal: "後進を育てる" },
		});
	});

	it("treats a goal that came from nowhere as new to this period", () => {
		expect(continuityOf(2, "済んだ目標", previous)).toBeNull();
		expect(continuityOf(1, "受注の手戻りを減らす", null)).toBeNull();
	});
});
