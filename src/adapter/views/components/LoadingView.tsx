import type { Component } from "solid-js";
import "../styles/loading.css";

const LoadingView: Component = () => {
	return (
		<div class="loading-container" role="alert" aria-busy="true">
			<div class="loading-content">
				<div class="loading-spinner"></div>
				<h2 class="loading-logo">TYPA</h2>
				<p class="loading-text">ログイン試行中...</p>
			</div>
		</div>
	);
};

export default LoadingView;
