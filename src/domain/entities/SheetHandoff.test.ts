import { describe, expect, it } from "vitest";
import { employee, milestone, period } from "../../test/fixtures";
import { EvaluationStatus } from "../valueObjects/EvaluationStatus";
import { Employee } from "./Employee";
import { EvaluationSheet } from "./EvaluationSheet";

// 業務のきまり: この状態のとき、ボールを持っている(次に動く)のは誰か。

function sheet(options: { status?: EvaluationStatus; primaryIsFinal?: boolean } = {}) {
	const subject = options.primaryIsFinal
		? new Employee(1, "本人", "E001", 1, "技術", 5, 2, null, true)
		: employee();
	return EvaluationSheet.create({
		sheetId: 100,
		subject,
		evaluationPeriod: period(),
		primaryEvaluatorName: "一次",
		secondaryEvaluatorName: options.primaryIsFinal ? "" : "二次",
		objectives: [milestone()],
		status: options.status ?? EvaluationStatus.GOALS_SUBMITTED,
	});
}

describe("ボールを持っている人", () => {
	it.each([
		[EvaluationStatus.DRAFT, "subject"],
		[EvaluationStatus.GOALS_SUBMITTED, "primary"],
		[EvaluationStatus.GOALS_CONFIRMED, "subject"],
		[EvaluationStatus.SUBMITTED, "primary"],
		[EvaluationStatus.FIRST_EVALUATED, "secondary"],
		[EvaluationStatus.FINALIZED, null],
	] as const)("%s のときは %s", (status, holder) => {
		expect(status.holder()).toBe(holder);
	});

	it("状態を受け取る相手(handoff の to)は、その状態のボールの持ち主と同じ", () => {
		for (const status of EvaluationStatus.ALL) {
			expect(status.handoff()?.to ?? null).toBe(status.holder());
		}
	});

	it("二次評価者なしの社員では、一次評価済みのボールは一次評価者が持つ", () => {
		const own = sheet({ status: EvaluationStatus.FIRST_EVALUATED, primaryIsFinal: true });
		expect(own.currentHolder()).toEqual({ actor: "primary", name: "一次" });
	});

	it.each([
		[EvaluationStatus.DRAFT, { actor: "subject", name: "テスト社員" }],
		[EvaluationStatus.GOALS_CONFIRMED, { actor: "subject", name: "テスト社員" }],
		[EvaluationStatus.SUBMITTED, { actor: "primary", name: "一次" }],
		[EvaluationStatus.FIRST_EVALUATED, { actor: "secondary", name: "二次" }],
		[EvaluationStatus.FINALIZED, null],
	] as const)("シートの %s の担当は %o", (status, holder) => {
		expect(sheet({ status }).currentHolder()).toEqual(holder);
	});

	it("状態は「いま何を待っているか」で呼ぶ(済・中は使わない)。両端だけは自然な言葉にする", () => {
		expect(EvaluationStatus.ALL.map((status) => status.label())).toEqual([
			"下書き",
			"目標確認待ち",
			"振り返り待ち",
			"一次評価待ち",
			"二次評価待ち",
			"評価確定",
		]);
	});
});
