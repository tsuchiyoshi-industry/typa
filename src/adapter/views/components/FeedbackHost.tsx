import { type JSX, Portal } from "@solidjs/web";
import { type Component, createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { dismissToast, onToastExit, pendingConfirm, settleConfirm, toasts } from "../feedback";
import { ArrowRight, CircleAlert, CircleCheck, Eye, Info, X } from "./icons";
import { sheetNotificationMount } from "./sheetNotificationMount";

const ConfirmDialog: Component = () => {
	let dialogRef: HTMLDialogElement | undefined;
	// 書いてもらう文の長さ。確認を開くたびに最初の文の長さから始め、書くたびに書き換える。範囲の外なら実行のボタンを押せない
	const [textLength, setTextLength] = createSignal(() => {
		const text = pendingConfirm()?.text;
		return text ? text.lengthOf(text.initial ?? "") : 0;
	});
	const textOutOfRange = () => {
		const text = pendingConfirm()?.text;
		return !!text && (textLength() === 0 || textLength() > text.maxLength);
	};

	createEffect(
		() => !!pendingConfirm(),
		(open) => {
			if (open) {
				dialogRef?.showModal();
			} else if (dialogRef?.open) {
				dialogRef.close();
			}
		},
	);

	return (
		<dialog
			ref={dialogRef}
			class="confirm-dialog"
			aria-labelledby="confirm-dialog-title"
			aria-describedby="confirm-dialog-message"
			onCancel={(event) => {
				event.preventDefault();
				settleConfirm(false);
			}}
		>
			<Show when={pendingConfirm()}>
				{(request) => (
					<div class="confirm-dialog__body">
						<h2 id="confirm-dialog-title">{request().title}</h2>
						<p id="confirm-dialog-message">{request().message}</p>
						<Show when={request().details}>
							{(details) => (
								<ul class="confirm-dialog__details">
									<For each={details()}>{(detail) => <li>{detail}</li>}</For>
								</ul>
							)}
						</Show>
						<Show when={request().note}>
							<p class="confirm-dialog__note">
								<ArrowRight size={14} aria-hidden="true" />
								{request().note}
							</p>
						</Show>
						<Show when={request().checkbox}>
							{(checkbox) => (
								<label class="confirm-dialog__checkbox">
									<input
										type="checkbox"
										checked
										onChange={(event) => checkbox().onChange(event.currentTarget.checked)}
									/>
									{checkbox().label}
								</label>
							)}
						</Show>
						<Show when={request().radio}>
							{(radio) => (
								<fieldset class="confirm-dialog__radio-group">
									<legend>{radio().label}</legend>
									<For each={radio().options}>
										{(option, index) => (
											<label class="confirm-dialog__radio">
												<input
													type="radio"
													name="confirm-dialog-choice"
													value={option.value}
													checked={radio().initial === option.value}
													aria-describedby={`confirm-dialog-choice-${index()}`}
													onChange={() => radio().onChange(option.value)}
												/>
												<span>
													<span>{option.label}</span>
													<small id={`confirm-dialog-choice-${index()}`}>
														{option.description}
													</small>
												</span>
											</label>
										)}
									</For>
								</fieldset>
							)}
						</Show>
						<Show when={request().text}>
							{(text) => (
								<label class="confirm-dialog__text">
									<span class="confirm-dialog__text-label">{text().label}</span>
									<span class="confirm-dialog__audience" id="confirm-dialog-audience">
										<Eye size={14} aria-hidden="true" />
										{text().audience}
									</span>
									<textarea
										rows={4}
										autofocus
										defaultValue={text().initial ?? ""}
										placeholder={text().placeholder}
										aria-describedby="confirm-dialog-audience confirm-dialog-count"
										aria-invalid={textLength() > text().maxLength ? "true" : "false"}
										onInput={(event) => {
											setTextLength(text().lengthOf(event.currentTarget.value));
											text().onInput(event.currentTarget.value);
										}}
									/>
									<span
										id="confirm-dialog-count"
										class={["confirm-dialog__count", { over: textLength() > text().maxLength }]}
									>
										{textLength()} / {text().maxLength} 文字
										{textLength() > text().maxLength
											? `（${textLength() - text().maxLength} 文字多すぎます）`
											: ""}
									</span>
								</label>
							)}
						</Show>
						<div class="confirm-dialog__actions">
							{/* 取り消せない操作で Enter を押しても実行されないよう、キャンセル側に初期フォーカス。書く欄があればそちら */}
							<Show when={!request().acknowledgeOnly}>
								<button
									type="button"
									class="secondary-action"
									autofocus={!request().text}
									onClick={() => settleConfirm(false)}
								>
									{request().cancelLabel ?? "キャンセル"}
								</button>
							</Show>
							<button
								type="button"
								class={["primary-action", { danger: request().tone === "danger" }]}
								disabled={textOutOfRange()}
								onClick={() => settleConfirm(true)}
							>
								{request().confirmLabel}
							</button>
						</div>
					</div>
				)}
			</Show>
		</dialog>
	);
};

const ToastStack: Component = () => (
	<div class="toast-stack" aria-live="polite">
		<For each={toasts()}>
			{(toast) => {
				let element!: HTMLDivElement;
				onCleanup(
					onToastExit(toast.id, () => {
						element.classList.add("leaving");
						const animations = element.getAnimations?.() ?? [];
						return Promise.allSettled(animations.map((animation) => animation.finished));
					}),
				);
				return (
					<div
						ref={element}
						class={`toast ${toast.kind}`}
						role={toast.kind === "error" ? "alert" : "status"}
					>
						{toast.kind === "success" ? (
							<CircleCheck class="toast__icon" />
						) : toast.kind === "error" ? (
							<CircleAlert class="toast__icon" />
						) : (
							<Info class="toast__icon" />
						)}
						<div class="toast__copy">
							<strong>{toast.message}</strong>
							<Show when={toast.detail}>
								<span>{toast.detail}</span>
							</Show>
							<Show when={toast.action}>
								{(action) => (
									<button
										type="button"
										class="toast__action"
										onClick={() => {
											action().run();
											dismissToast(toast.id);
										}}
									>
										{action().label}
									</button>
								)}
							</Show>
						</div>
						<button
							type="button"
							class="toast__close"
							aria-label="通知を閉じる"
							onClick={() => dismissToast(toast.id)}
						>
							<X size={14} />
						</button>
					</div>
				);
			}}
		</For>
	</div>
);

const FeedbackHost: Component<{ children?: JSX.Element }> = (props) => (
	<>
		<Portal mount={sheetNotificationMount() ?? document.body}>
			{props.children}
			<ToastStack />
		</Portal>
		<ConfirmDialog />
	</>
);

export default FeedbackHost;
