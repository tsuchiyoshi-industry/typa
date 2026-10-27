import ArrowRight from "lucide-solid/icons/arrow-right";
import CircleAlert from "lucide-solid/icons/circle-alert";
import CircleCheck from "lucide-solid/icons/circle-check";
import Eye from "lucide-solid/icons/eye";
import Info from "lucide-solid/icons/info";
import X from "lucide-solid/icons/x";
import { type Component, createEffect, createSignal, For, Show } from "solid-js";
import { dismissToast, leavingToasts, pendingConfirm, settleConfirm, toasts } from "../feedback";

const ConfirmDialog: Component = () => {
	let dialogRef: HTMLDialogElement | undefined;
	// 書いてもらう文の長さ。範囲の外なら実行のボタンを押せない
	const [textLength, setTextLength] = createSignal(0);
	const textOutOfRange = () => {
		const text = pendingConfirm()?.text;
		return !!text && (textLength() === 0 || textLength() > text.maxLength);
	};

	createEffect(() => {
		const text = pendingConfirm()?.text;
		setTextLength(text ? text.lengthOf(text.initial ?? "") : 0);
	});

	createEffect(() => {
		if (pendingConfirm()) {
			dialogRef?.showModal();
		} else if (dialogRef?.open) {
			dialogRef.close();
		}
	});

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
										value={text().initial ?? ""}
										placeholder={text().placeholder}
										aria-describedby="confirm-dialog-audience confirm-dialog-count"
										aria-invalid={textLength() > text().maxLength}
										onInput={(event) => {
											setTextLength(text().lengthOf(event.currentTarget.value));
											text().onInput(event.currentTarget.value);
										}}
									/>
									<span
										id="confirm-dialog-count"
										class="confirm-dialog__count"
										classList={{ over: textLength() > text().maxLength }}
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
								class="primary-action"
								classList={{ danger: request().tone === "danger" }}
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
			{(toast) => (
				<div
					classList={{
						toast: true,
						[toast.kind]: true,
						leaving: leavingToasts().has(toast.id),
					}}
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
			)}
		</For>
	</div>
);

const FeedbackHost: Component = () => (
	<>
		<ToastStack />
		<ConfirmDialog />
	</>
);

export default FeedbackHost;
