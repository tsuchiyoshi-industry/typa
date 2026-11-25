import {
	createRouter,
	type MemoryHistoryAdapter,
	memoryHistory,
	type RouteDefinition,
	type RouteSectionProps,
} from "@solidjs/router";
import type { JSX } from "@solidjs/web";
import type { Component } from "solid-js";

/**
 * 画面をルーターの中で描く(useNavigate・useBeforeLeave・<a> の現在地が要る画面のテスト)。
 * 2.0 のルーターは JSX の <MemoryRouter>/<Route> を持たないので、テストごとにルーターを作る。
 * 画面を1つ渡すと、どのパスでもその画面を出す。移った先も確かめるときはルートの表を渡す。
 * history を渡すと、テストから移動させたり、いまの場所を読んだりできる。root は全体の枠。
 */
export function routed(
	view: Component | RouteDefinition[],
	options: {
		history?: MemoryHistoryAdapter;
		root?: (props: RouteSectionProps) => JSX.Element;
	} = {},
): JSX.Element {
	const routes = typeof view === "function" ? [{ path: "*", component: view }] : view;
	const Router = createRouter({ routes, history: options.history ?? memoryHistory("/") });
	return <Router>{options.root}</Router>;
}
