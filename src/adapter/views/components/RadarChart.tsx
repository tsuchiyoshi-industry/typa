import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import type { RadarData } from "../../viewmodels/commonEvaluationRadar";

interface RadarChartProps extends RadarData {
	/** 何のチャートか。読み上げと見出しに使う。 */
	title: string;
}

const WIDTH = 480;
const HEIGHT = 330;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
const RADIUS = 108;
const LABEL_GAP = 16;
/** 目盛りの輪。得点率 25% ごと。 */
const RINGS = [0.25, 0.5, 0.75, 1];

/** 長いラベルは「（」や「・」の前で 2 行に分け、チャートの外にはみ出さないようにする。 */
function labelLines(label: string): string[] {
	if (label.length <= 7) {
		return [label];
	}
	const at = Math.max(label.indexOf("（"), label.indexOf("・") + 1);
	const cut = at > 0 && at < label.length ? at : Math.ceil(label.length / 2);
	return [label.slice(0, cut), label.slice(cut)];
}

/**
 * 軸ごとの得点率を、段階(一次評価・最終評価)ごとの多角形で示す。
 * 値は軸の満点に対する割合で描くので、満点が違う軸どうしも同じ尺度で比べられる。
 * 色だけに頼らないよう、凡例を出し、一次評価は破線にする。点数はホバーの表示と読み上げ用の一覧で伝える。
 */
const RadarChart: Component<RadarChartProps> = (props) => {
	const [active, setActive] = createSignal<number | null>(null);
	const count = () => props.axes.length;
	const angle = (index: number) => -Math.PI / 2 + (2 * Math.PI * index) / count();
	const point = (index: number, rate: number, extra = 0) => {
		const distance = RADIUS * rate + extra;
		return [
			CENTER_X + distance * Math.cos(angle(index)),
			CENTER_Y + distance * Math.sin(angle(index)),
		] as const;
	};
	const rate = (axisIndex: number, seriesIndex: number) => {
		const axis = props.axes[axisIndex];
		return axis.max > 0 ? Math.min(1, axis.values[seriesIndex] / axis.max) : 0;
	};
	const ring = (value: number) =>
		props.axes.map((_, index) => point(index, value).join(",")).join(" ");
	const shapes = createMemo(() =>
		props.series.map((item, seriesIndex) => ({
			...item,
			points: props.axes.map((_, index) => point(index, rate(index, seriesIndex))),
		})),
	);
	// ホバーの当たり判定は、点ではなく軸のまわりの扇形全体にする
	const sector = (index: number) => {
		const half = Math.PI / count();
		const outer = RADIUS + LABEL_GAP + 34;
		const at = (theta: number) =>
			`${CENTER_X + outer * Math.cos(theta)},${CENTER_Y + outer * Math.sin(theta)}`;
		return `M${CENTER_X},${CENTER_Y} L${at(angle(index) - half)} A${outer},${outer} 0 0 1 ${at(angle(index) + half)} Z`;
	};
	const readout = (index: number) =>
		`${props.axes[index].label}: ${props.series
			.map((item, i) => `${item.name} ${props.axes[index].values[i]} / ${props.axes[index].max} 点`)
			.join("、")}`;

	return (
		<figure class="radar-chart">
			<figcaption>{props.title}</figcaption>
			<Show when={props.series.length > 1}>
				<ul class="radar-legend">
					<For each={props.series}>
						{(item) => (
							<li>
								<svg width="22" height="10" aria-hidden="true">
									<line class={`radar-line ${item.key}`} x1="1" y1="5" x2="21" y2="5" />
								</svg>
								{item.name}
							</li>
						)}
					</For>
				</ul>
			</Show>
			<svg
				class="radar-plot"
				viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
				role="img"
				aria-label={`${props.title}のレーダーチャート。値はこの下の一覧にあります。`}
				onMouseLeave={() => setActive(null)}
			>
				<For each={RINGS}>{(value) => <polygon class="radar-ring" points={ring(value)} />}</For>
				<For each={props.axes}>
					{(_, index) => (
						<line
							class="radar-spoke"
							classList={{ active: active() === index() }}
							x1={CENTER_X}
							y1={CENTER_Y}
							x2={point(index(), 1)[0]}
							y2={point(index(), 1)[1]}
						/>
					)}
				</For>
				{/* 目盛りは軸と軸の間に置く。軸の上はデータの点が来るので重なる */}
				<For each={[0.5, 1]}>
					{(value) => {
						const between = angle(0) + Math.PI / count();
						const distance = RADIUS * value * Math.cos(Math.PI / count());
						return (
							<text
								class="radar-tick"
								x={CENTER_X + distance * Math.cos(between)}
								y={CENTER_Y + distance * Math.sin(between)}
								text-anchor="middle"
								dominant-baseline="middle"
							>
								{value * 100}%
							</text>
						);
					}}
				</For>
				<For each={shapes()}>
					{(shape) => (
						<g>
							<polygon
								class={`radar-area ${shape.key}`}
								points={shape.points.map((p) => p.join(",")).join(" ")}
							/>
							<polygon
								class={`radar-line ${shape.key}`}
								points={shape.points.map((p) => p.join(",")).join(" ")}
							/>
							<For each={shape.points}>
								{(p, index) => (
									<circle
										class={`radar-dot ${shape.key}`}
										cx={p[0]}
										cy={p[1]}
										r={active() === index() ? 5.5 : 4}
									/>
								)}
							</For>
						</g>
					)}
				</For>
				<For each={props.axes}>
					{(axis, index) => {
						const [x, y] = point(index(), 1, LABEL_GAP);
						const cos = Math.cos(angle(index()));
						const lines = labelLines(axis.label);
						return (
							<text
								class="radar-label"
								classList={{ active: active() === index() }}
								x={x}
								// 上下の端のラベルは中央寄せ、左右は外側へ伸ばす
								text-anchor={Math.abs(cos) < 0.2 ? "middle" : cos > 0 ? "start" : "end"}
								y={y - (lines.length - 1) * 6.5}
								dominant-baseline="middle"
							>
								<For each={lines}>
									{(line, lineIndex) => (
										<tspan x={x} dy={lineIndex() === 0 ? 0 : 13}>
											{line}
										</tspan>
									)}
								</For>
							</text>
						);
					}}
				</For>
				<For each={props.axes}>
					{(_, index) => (
						// biome-ignore lint/a11y/noStaticElementInteractions: 点数は下の一覧でも読める。扇形はマウス用の当たり判定
						<path class="radar-hit" d={sector(index())} onMouseEnter={() => setActive(index())} />
					)}
				</For>
			</svg>
			<p class="radar-readout" aria-hidden="true">
				{active() === null
					? "項目にカーソルを合わせると点数を表示します。"
					: readout(active() as number)}
			</p>
			<ul class="visually-hidden">
				<For each={props.axes}>{(_, index) => <li>{readout(index())}</li>}</For>
			</ul>
		</figure>
	);
};

export default RadarChart;
