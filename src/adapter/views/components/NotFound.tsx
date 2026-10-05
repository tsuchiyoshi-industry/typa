import { A } from "@solidjs/router";
import type { Component } from "solid-js";

export const NotFound: Component = () => (
	<div class="notfound-card">
		<h1>404</h1>
		<p>このページは見つかりませんでした。移動または削除された可能性があります。</p>
		<A href="/" class="create-sheet-button">
			評価シート一覧へ戻る
		</A>
	</div>
);
