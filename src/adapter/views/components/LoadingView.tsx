import type { Component } from "solid-js";
import "../styles/loading.css";

const LoadingView: Component = () => {
	return (
		<div class="loading-container" role="alert" aria-busy="true">
			<div class="loading-content">
				{/* ロゴアニメ */}
				<div class="logo-wrapper">
					<div class="logo-full-text">
						<span class="main-char">T</span>
						<span class="main-char">Y&nbsp;</span>
						<span class="main-char">P</span>
						<span class="sub-text">erformance&nbsp;</span>
						<span class="main-char">A</span>
						<span class="sub-text">ppraisal</span>
					</div>
				</div>

				{/* 補助的なインジケーター */}
				<div class="loading-bar-container">
					<div class="loading-bar-fill"></div>
				</div>
				<p class="loading-text">Authenticating...</p>
			</div>
		</div>
	);
};

export default LoadingView;
