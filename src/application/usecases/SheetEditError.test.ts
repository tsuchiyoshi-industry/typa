import { describe, expect, it } from "vitest";
import { describeMilestoneError } from "../../domain/entities/MilestoneError";
import { describeSheetTransitionError } from "../../domain/entities/SheetTransitionError";
import { describeSheetAccessError, type SheetAction } from "../../domain/services/SheetAccessError";
import { EVALUATION_STATUS_VALUES } from "../../domain/valueObjects/EvaluationStatus";
import { describeSheetEditError, type SheetEditError } from "./SheetEditError";

// 失敗の種類をすべて挙げる。種類を足すと、ここが型エラーになる
const every = {
	sheetNotFound: { kind: "sheetNotFound" },
	goalNotOnSheet: { kind: "goalNotOnSheet" },
	goalNumberInvalid: { kind: "goalNumberInvalid" },
	tooManyGoals: { kind: "tooManyGoals", max: 3 },
	lastGoal: { kind: "lastGoal" },
	nothingToSave: { kind: "nothingToSave" },
	scoreOutOfRange: { kind: "scoreOutOfRange" },
	actionUnknown: { kind: "actionUnknown" },
	previousGoalInvalid: { kind: "previousGoalInvalid" },
	commonItemInvalid: { kind: "commonItemInvalid" },
	periodClosed: { kind: "periodClosed" },
	forbidden: { kind: "forbidden", action: "view" },
	transitionForbidden: { kind: "transitionForbidden", to: "finalized" },
	periodGoalsMalformed: { kind: "periodGoalsMalformed" },
	tooManyPeriodGoals: { kind: "tooManyPeriodGoals", max: 4 },
	achievementBesideTasks: { kind: "achievementBesideTasks" },
	goalsFixed: { kind: "goalsFixed" },
	achievementBeforeConfirmation: { kind: "achievementBeforeConfirmation" },
	objectivesIncomplete: { kind: "objectivesIncomplete", missing: ["目標 2：チャレンジ目標"] },
	evaluationIncomplete: { kind: "evaluationIncomplete", stage: "second", pending: ["項目"] },
	returnReasonInvalid: { kind: "returnReasonInvalid", max: 200 },
} satisfies { [K in SheetEditError["kind"]]: Extract<SheetEditError, { kind: K }> };

describe("describing a failure to the person who caused it", () => {
	it.each([
		["sheetNotFound", "評価シートが見つかりません。"],
		["goalNotOnSheet", "対象の目標はこの評価シートに属していません。"],
		["goalNumberInvalid", "目標番号が不正です。"],
		["tooManyGoals", "チャレンジ目標は最大3件です。"],
		["lastGoal", "チャレンジ目標は最低1件必要です。"],
		["nothingToSave", "保存する内容がありません。"],
		["scoreOutOfRange", "評価点は 0〜4 の整数で指定してください。"],
		["actionUnknown", "目標への操作が不正です。"],
		["previousGoalInvalid", "前期の目標が不正です。"],
		["commonItemInvalid", "共通評価項目が不正または重複しています。"],
	] as const)("says what was wrong with the request: %s", (kind, message) => {
		expect(describeSheetEditError(every[kind])).toBe(message);
	});

	it.each(Object.values(every))("routes $kind to the wording of its own kind", (error) => {
		const message = describeSheetEditError(error);
		switch (error.kind) {
			case "periodClosed":
			case "forbidden":
			case "transitionForbidden":
				return expect(message).toBe(describeSheetAccessError(error));
			case "periodGoalsMalformed":
			case "tooManyPeriodGoals":
			case "achievementBesideTasks":
			case "goalsFixed":
			case "achievementBeforeConfirmation":
				return expect(message).toBe(describeMilestoneError(error));
			case "objectivesIncomplete":
			case "evaluationIncomplete":
			case "returnReasonInvalid":
				return expect(message).toBe(describeSheetTransitionError(error));
			default:
				return expect(message).not.toBe("");
		}
	});

	it("gives every refused action and transition its own explanation", () => {
		const actions: SheetAction[] = [
			"view",
			"deleteGoal",
			"editGoalText",
			"editFirstScore",
			"editSecondScore",
			"editCommonEvaluation",
			"editFirstOverallComment",
			"editSecondOverallComment",
			"carryOverGoal",
			"resendNotification",
		];
		const messages = [
			...actions.map((action) => describeSheetAccessError({ kind: "forbidden", action })),
			...EVALUATION_STATUS_VALUES.map((to) =>
				describeSheetAccessError({ kind: "transitionForbidden", to }),
			),
			describeSheetAccessError({ kind: "periodClosed" }),
		];
		expect(messages.every((message) => message.length > 0)).toBe(true);
		expect(new Set(messages).size).toBe(messages.length);
	});
});
