import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { Download, RefreshCw, RotateCw, X } from "lucide-solid";
import {
	type Component,
	createMemo,
	createSignal,
	Match,
	onCleanup,
	onMount,
	Show,
	Switch,
} from "solid-js";

type UpdateStatus = "idle" | "available" | "downloading" | "installing" | "restarting" | "error";

const formatBytes = (bytes: number) => {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${Math.round(bytes / 1024)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const AutoUpdateNotification: Component = () => {
	const [update, setUpdate] = createSignal<Update | null>(null);
	const [status, setStatus] = createSignal<UpdateStatus>("idle");
	const [errorMessage, setErrorMessage] = createSignal("");
	const [dismissed, setDismissed] = createSignal(false);
	const [downloadedBytes, setDownloadedBytes] = createSignal(0);
	const [contentLength, setContentLength] = createSignal<number | null>(null);
	const [restartCountdown, setRestartCountdown] = createSignal(5);
	let restartTimer: number | undefined;

	const progress = createMemo(() => {
		const total = contentLength();
		if (!total || total <= 0) {
			return null;
		}
		return Math.min(100, Math.round((downloadedBytes() / total) * 100));
	});

	const downloadedLabel = createMemo(() => {
		const total = contentLength();
		if (!total) {
			return formatBytes(downloadedBytes());
		}
		return `${formatBytes(downloadedBytes())} / ${formatBytes(total)}`;
	});

	const releaseNote = createMemo(() => {
		const body = update()?.body?.trim();
		if (!body) {
			return null;
		}
		return body.length > 180 ? `${body.slice(0, 180)}...` : body;
	});

	onMount(async () => {
		if (!isTauri()) {
			return;
		}

		try {
			const availableUpdate = await check();
			if (availableUpdate) {
				setUpdate(availableUpdate);
				setStatus("available");
			}
		} catch (error) {
			setStatus("error");
			console.error("Failed to check for updates:", error);
			setErrorMessage(error instanceof Error ? error.message : "更新情報の確認に失敗しました。");
		}
	});

	onCleanup(() => {
		if (restartTimer !== undefined) {
			window.clearInterval(restartTimer);
		}
		const currentUpdate = update();
		if (currentUpdate && status() !== "downloading" && status() !== "installing") {
			void currentUpdate.close();
		}
	});

	const dismiss = () => {
		setDismissed(true);
		const currentUpdate = update();
		if (currentUpdate && status() !== "downloading" && status() !== "installing") {
			void currentUpdate.close();
		}
	};

	const handleDownloadEvent = (event: DownloadEvent) => {
		if (event.event === "Started") {
			setDownloadedBytes(0);
			setContentLength(event.data.contentLength ?? null);
			return;
		}

		if (event.event === "Progress") {
			setDownloadedBytes((value) => value + event.data.chunkLength);
			return;
		}

		setStatus("installing");
	};

	const relaunchApp = async () => {
		try {
			await relaunch();
		} catch (error) {
			if (restartTimer !== undefined) {
				window.clearInterval(restartTimer);
				restartTimer = undefined;
			}
			setStatus("error");
			setErrorMessage(error instanceof Error ? error.message : "アプリの再起動に失敗しました。");
		}
	};

	const scheduleRelaunch = () => {
		setStatus("restarting");
		setRestartCountdown(5);
		restartTimer = window.setInterval(() => {
			setRestartCountdown((seconds) => {
				if (seconds <= 1) {
					if (restartTimer !== undefined) {
						window.clearInterval(restartTimer);
						restartTimer = undefined;
					}
					void relaunchApp();
					return 0;
				}
				return seconds - 1;
			});
		}, 1000);
	};

	const postponeRelaunch = () => {
		if (restartTimer !== undefined) {
			window.clearInterval(restartTimer);
			restartTimer = undefined;
		}
		const currentUpdate = update();
		if (currentUpdate) {
			void currentUpdate.close();
		}
		setDismissed(true);
	};

	const installUpdate = async () => {
		const currentUpdate = update();
		if (!currentUpdate) {
			return;
		}

		setStatus("downloading");
		setErrorMessage("");
		try {
			await currentUpdate.downloadAndInstall(handleDownloadEvent);
			scheduleRelaunch();
		} catch (error) {
			setStatus("error");
			setErrorMessage(
				error instanceof Error ? error.message : "更新のインストールに失敗しました。",
			);
		}
	};

	return (
		<Show when={!dismissed() && status() !== "idle"}>
			<section class={`auto-update-notification ${status()}`} aria-live="polite" aria-atomic="true">
				<div class="auto-update-content">
					<Switch fallback={<Download class="auto-update-icon" />}>
						<Match when={status() === "error"}>
							<RefreshCw class="auto-update-icon" />
						</Match>
						<Match when={status() === "restarting"}>
							<RotateCw class="auto-update-icon" />
						</Match>
					</Switch>
					<div class="auto-update-copy">
						<Switch>
							<Match when={status() === "available"}>
								<strong>新しいバージョンがあります</strong>
								<span>
									現在 {update()?.currentVersion} / 最新 {update()?.version}
								</span>
								<Show when={releaseNote()}>
									<p>{releaseNote()}</p>
								</Show>
							</Match>
							<Match when={status() === "downloading"}>
								<strong>更新をダウンロードしています</strong>
								<span>
									{progress() !== null ? `${progress()}%` : "進捗を確認中"} - {downloadedLabel()}
								</span>
							</Match>
							<Match when={status() === "installing"}>
								<strong>更新をインストールしています</strong>
								<span>完了までアプリを閉じずにお待ちください。</span>
							</Match>
							<Match when={status() === "restarting"}>
								<strong>更新をインストールしました</strong>
								<span>{restartCountdown()}秒後に自動で再起動します。</span>
							</Match>
							<Match when={status() === "error"}>
								<strong>更新処理で問題が発生しました</strong>
								<span>{errorMessage()}</span>
							</Match>
						</Switch>
					</div>
				</div>

				<Show when={status() === "downloading" && progress() !== null}>
					<div class="auto-update-progress" aria-hidden="true">
						<div style={{ width: `${progress()}%` }} />
					</div>
				</Show>

				<div class="auto-update-actions">
					<Show when={status() === "available"}>
						<button type="button" class="auto-update-primary" onClick={() => void installUpdate()}>
							<Download size={16} />
							<span>更新して再起動</span>
						</button>
						<button type="button" class="auto-update-secondary" onClick={dismiss}>
							あとで
						</button>
					</Show>
					<Show when={status() === "restarting"}>
						<button type="button" class="auto-update-primary" onClick={() => void relaunchApp()}>
							<RotateCw size={16} />
							<span>今すぐ再起動</span>
						</button>
						<button type="button" class="auto-update-secondary" onClick={postponeRelaunch}>
							あとで
						</button>
					</Show>
					<Show when={status() === "error"}>
						<button type="button" class="auto-update-close" onClick={dismiss} aria-label="閉じる">
							<X size={18} />
						</button>
					</Show>
				</div>
			</section>
		</Show>
	);
};

export default AutoUpdateNotification;
