import CircleAlert from "lucide-solid/icons/circle-alert";
import CircleCheck from "lucide-solid/icons/circle-check";
import Info from "lucide-solid/icons/info";
import X from "lucide-solid/icons/x";
import { type Component, createEffect, For, Show } from "solid-js";
import { dismissToast, pendingConfirm, settleConfirm, toasts } from "../feedback";

const ConfirmDialog: Component = () => {
	let dialogRef: HTMLDialogElement | undefined;

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
						<div class="confirm-dialog__actions">
							{/* 取り消せない操作で Enter を押しても実行されないよう、キャンセル側に初期フォーカス */}
							<Show when={!request().acknowledgeOnly}>
								<button
									type="button"
									class="secondary-action"
									autofocus
									onClick={() => settleConfirm(false)}
								>
									{request().cancelLabel ?? "キャンセル"}
								</button>
							</Show>
							<button
								type="button"
								class="primary-action"
								classList={{ danger: request().tone === "danger" }}
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
				<div class={`toast ${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>
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
					</div>
					<button
						type="button"
						class="toast__close"
						aria-label="通知を閉じる"
						onClick={() => dismissToast(toast.id)}
					>
						<X size={16} />
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
