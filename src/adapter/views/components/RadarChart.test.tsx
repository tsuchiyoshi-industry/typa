// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { CommonEvaluationResultDto } from "../../../application/dtos/CommonEvaluationDto";
import { commonEvaluationRadar } from "../../viewmodels/commonEvaluationRadar";
import RadarChart from "./RadarChart";

afterEach(cleanup);

const result = (
	id: number,
	title: string,
	firstScore: number,
	secondScore: number | null,
	weight = 1,
): CommonEvaluationResultDto => ({
	id,
	sheetId: 100,
	itemId: id,
	firstScore,
	secondScore,
	firstComment: "",
	item: { id, title, description: "説明", weight, itemSetId: 1 },
});
const results = [
	result(1, "スピード", 3, 4),
	result(2, "報連相", 2, 3),
	result(3, "学習意欲", 4, 4),
	// 同じタイトルの項目はひとつの軸に足し込む。配点 2 は係数
	result(4, "業務遂行態度（実行力）", 1, 2),
	result(5, "業務遂行態度（実行力）", 4, 4, 2),
];

describe("common evaluation by item title", () => {
	it("sums weighted points per title against the title's full score", () => {
		expect(commonEvaluationRadar(results, false)).toEqual({
			series: [
				{ key: "first", name: "一次評価" },
				{ key: "final", name: "最終評価" },
			],
			axes: [
				{ label: "スピード", max: 4, values: [3, 4] },
				{ label: "報連相", max: 4, values: [2, 3] },
				{ label: "学習意欲", max: 4, values: [4, 4] },
				// (1×1 + 2×4) / ((1 + 2) × 4) と (1×2 + 2×4) / 12
				{ label: "業務遂行態度（実行力）", max: 12, values: [9, 10] },
			],
		});
	});
	it("shows only what the viewer may see, and the primary evaluation as final when there is no secondary", () => {
		// 一次評価者には二次評価が伏せられている
		const masked = results.map((row) => ({ ...row, secondScore: null }));
		expect(commonEvaluationRadar(masked, false)).toMatchObject({
			series: [{ key: "first", name: "一次評価" }],
			axes: [{ values: [3] }, { values: [2] }, { values: [4] }, { values: [9] }],
		});
		expect(commonEvaluationRadar(results, true)).toMatchObject({
			series: [{ key: "final", name: "最終評価" }],
			axes: [{ values: [3] }, { values: [2] }, { values: [4] }, { values: [9] }],
		});
	});
	it("draws nothing with fewer than three titles", () => {
		expect(commonEvaluationRadar(results.slice(0, 2), false)).toBeNull();
		expect(commonEvaluationRadar([], false)).toBeNull();
	});
});

describe("radar chart", () => {
	const data = commonEvaluationRadar(results, false);
	if (!data) {
		throw new Error("fixture must produce a chart");
	}

	it("identifies each series without relying on color, and lists every value as text", () => {
		const view = render(() => <RadarChart title="共通評価の項目別の得点" {...data} />);
		expect(view.getByText("一次評価")).toBeTruthy();
		expect(view.getByText("最終評価")).toBeTruthy();
		expect(view.getByRole("img").getAttribute("aria-label")).toContain("共通評価の項目別の得点");
		expect(view.container.querySelectorAll("polygon.radar-line")).toHaveLength(2);
		expect(view.container.querySelectorAll("circle.radar-dot")).toHaveLength(8);
		expect(view.getAllByRole("listitem").map((item) => item.textContent)).toContain(
			"業務遂行態度（実行力）: 一次評価 9 / 12 点、最終評価 10 / 12 点",
		);
	});
	it("places the full-score vertex on the outer ring and scales the others by rate", () => {
		const view = render(() => <RadarChart title="t" {...data} />);
		const final = view.container.querySelector("polygon.radar-line.final");
		const [top, right] = (final?.getAttribute("points") ?? "")
			.split(" ")
			.map((pair) => pair.split(",").map(Number));
		// 1 つ目の軸は真上。最終評価 4 / 4 は半径いっぱい(中心 240,165・半径 108)
		expect(top[0]).toBeCloseTo(240);
		expect(top[1]).toBeCloseTo(165 - 108);
		// 2 つ目の軸(右)は 3 / 4
		expect(right[0]).toBeCloseTo(240 + 108 * 0.75);
		expect(right[1]).toBeCloseTo(165);
	});
	it("shows the points of the hovered item", () => {
		const view = render(() => <RadarChart title="t" {...data} />);
		const readout = view.container.querySelector(".radar-readout");
		expect(readout?.textContent).toContain("カーソルを合わせる");
		fireEvent.mouseEnter(view.container.querySelectorAll(".radar-hit")[1]);
		expect(readout?.textContent).toBe("報連相: 一次評価 2 / 4 点、最終評価 3 / 4 点");
		fireEvent.mouseLeave(view.getByRole("img"));
		expect(readout?.textContent).toContain("カーソルを合わせる");
	});
	it("needs no legend for a single series", () => {
		const single = commonEvaluationRadar(results, true);
		const view = render(() => <RadarChart title="t" {...(single as NonNullable<typeof single>)} />);
		expect(view.container.querySelector(".radar-legend")).toBeNull();
		expect(view.container.querySelectorAll("polygon.radar-line")).toHaveLength(1);
	});
});
