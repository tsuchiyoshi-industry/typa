import type { CommonEvaluationResultDto } from "../../application/dtos/CommonEvaluationDto";
import { Score } from "../../domain/valueObjects/Score";

/** 系列は評価の段階で決まる。色は段階に付き、表示する系列の数や順番では変わらない。 */
export type RadarSeriesKey = "first" | "final";

export interface RadarSeries {
	key: RadarSeriesKey;
	name: string;
}

export interface RadarAxis {
	label: string;
	/** この軸の満点。 */
	max: number;
	/** series と同じ並びの得点。 */
	values: number[];
}

export interface RadarData {
	axes: RadarAxis[];
	series: RadarSeries[];
}

/** 3 項目に満たないと多角形にならない。 */
const MIN_AXES = 3;

/**
 * 共通評価を項目のタイトルごとにまとめ、レーダーチャートの軸にする。
 * 得点は「配点 × 評価」の合計、満点は「配点 × 4」の合計。同じタイトルの項目はひとつの軸に足し込む。
 * 二次評価を見られない人(secondScore が null)には、一次評価の系列だけを返す。
 * 二次評価者「なし」の社員は、一次評価がそのまま最終評価になる。
 */
export function commonEvaluationRadar(
	results: CommonEvaluationResultDto[],
	primaryIsFinal: boolean,
): RadarData | null {
	const canSeeSecond = results.every((result) => result.secondScore !== null);
	const byTitle = new Map<string, { max: number; first: number; second: number }>();
	for (const result of results) {
		const axis = byTitle.get(result.item.title) ?? { max: 0, first: 0, second: 0 };
		axis.max += result.item.weight * Score.MAX;
		axis.first += result.item.weight * result.firstScore;
		axis.second += result.item.weight * (result.secondScore ?? 0);
		byTitle.set(result.item.title, axis);
	}
	if (byTitle.size < MIN_AXES) {
		return null;
	}

	const series: RadarSeries[] = primaryIsFinal
		? [{ key: "final", name: "最終評価" }]
		: canSeeSecond
			? [
					{ key: "first", name: "一次評価" },
					{ key: "final", name: "最終評価" },
				]
			: [{ key: "first", name: "一次評価" }];
	return {
		series,
		axes: [...byTitle].map(([label, axis]) => ({
			label,
			max: axis.max,
			values: series.map((item) =>
				item.key === "first" || primaryIsFinal ? axis.first : axis.second,
			),
		})),
	};
}
