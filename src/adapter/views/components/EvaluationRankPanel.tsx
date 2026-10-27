import Award from "lucide-solid/icons/award";
import { type Component, createMemo, For, Show } from "solid-js";
import type {
	EvaluationRankDto,
	EvaluationSheetDto,
} from "../../../application/dtos/EvaluationSheetDto";
import { EvaluationRank } from "../../../domain/valueObjects/EvaluationRank";
import { EvaluationStatus } from "../../../domain/valueObjects/EvaluationStatus";
import { commonEvaluationRadar } from "../../viewmodels/commonEvaluationRadar";
import RadarChart from "./RadarChart";

interface EvaluationRankPanelProps {
	sheet: EvaluationSheetDto;
	canEditSecond: boolean;
	canViewCommonEvaluation: boolean;
}

/** 評価ランク。最終評価ランクは、最終評価者の評価が始まる段階から意味を持つ。 */
const EvaluationRankPanel: Component<EvaluationRankPanelProps> = (props) => {
	const ranks = createMemo(() => {
		const sheet = props.sheet;
		const items: { label: string; rank: EvaluationRankDto }[] = [];
		if (sheet.firstEvaluationRank && !sheet.primaryIsFinalEvaluator) {
			items.push({ label: "一次評価ランク", rank: sheet.firstEvaluationRank });
		}
		if (
			sheet.finalEvaluationRank &&
			(sheet.primaryIsFinalEvaluator || sheet.finalEvaluationRank.confirmed || props.canEditSecond)
		) {
			items.push({ label: "最終評価ランク", rank: sheet.finalEvaluationRank });
		}
		return items;
	});
	// 確定した評価の内訳。共通評価を見られる人(評価者)にだけ、項目のタイトルごとの得点を図で見せる
	const radar = createMemo(() => {
		const summary = props.sheet.commonEvaluation;
		return EvaluationStatus.from(props.sheet.status).isFinalized() &&
			props.canViewCommonEvaluation &&
			summary
			? commonEvaluationRadar(summary.results, props.sheet.primaryIsFinalEvaluator)
			: null;
	});

	return (
		<Show when={ranks().length}>
			<section class="final-rank-panel">
				<div class="final-rank-panel__title">
					<Award class="section-icon" />
					<div>
						<h2>評価ランク</h2>
						<p>得点率で自動的に決まります（{EvaluationRank.describeThresholds()}）。</p>
					</div>
				</div>
				<dl class="rank-summary">
					<For each={ranks()}>
						{(item) => (
							<div class="rank-summary__item" classList={{ confirmed: item.rank.confirmed }}>
								<dt>{item.label}</dt>
								<dd>
									<strong>{item.rank.displayText}</strong>
									<span>{item.rank.score} 点 / 100 点</span>
									<small>{item.rank.confirmed ? "確定" : "確定前の見込み"}</small>
								</dd>
							</div>
						)}
					</For>
				</dl>
				<Show when={radar()}>
					{(data) => <RadarChart title="共通評価の項目別の得点" {...data()} />}
				</Show>
			</section>
		</Show>
	);
};

export default EvaluationRankPanel;
