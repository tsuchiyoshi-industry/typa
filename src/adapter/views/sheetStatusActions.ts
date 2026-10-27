import type { EvaluationRankDto } from "../../application/dtos/EvaluationSheetDto";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import type { SheetEditorController } from "../controllers/SheetEditorController";
import type { SheetEditorViewModel } from "../presenters/SheetEditorPresenter";
import { confirmAction, ensureNothingUnsaved, showToast } from "./feedback";

interface SheetStatusActionsOptions {
	controller: SheetEditorController;
	viewModel: () => SheetEditorViewModel;
	/** 確定の前に、自分の評価がすべて済んでいるか。済んでいなければ未設定の項目を知らせて false。 */
	ensureEvaluationComplete: () => boolean;
	onUpdated?: () => void;
	/** 差し戻し・確定が済んだとき。受け持ち画面が次の対象者へ進むのに使う。 */
	onStageCompleted?: () => void;
	/** 受け持ち画面ではないとき、差し戻した後に部下の一覧へ戻る。 */
	backToReview?: () => void;
	/** 確定の後に進む「次の対象者」の名前。いなければ undefined。 */
	announceNext?: () => string | undefined;
}

const rankText = (rank: EvaluationRankDto | undefined) =>
	rank ? `${rank.displayText}（${rank.score} 点 / 100 点）` : "—";

/**
 * 評価シートの状態を進める・戻す操作。どれも確認してから変える。
 * 状態が変わると編集権限も変わるため、入力中の内容は先に保存してもらう。
 */
export function createSheetStatusActions(options: SheetStatusActionsOptions) {
	const sheet = () => options.viewModel().sheet;

	/** notify: 確定の通知メールを送るか。送信の結果は、宛先ごとに後からトーストで届く。 */
	const changeStatus = async (status: EvaluationStatus, doneMessage: string, notify = true) => {
		const success = await options.controller.updateStatus(status, notify);
		if (success) {
			showToast("success", doneMessage);
			// 変更後のシートは保存の結果として届いているので、読み直さない
			options.onUpdated?.();
		} else if (options.viewModel().statusUpdateError) {
			await confirmAction({
				title: "変更できませんでした",
				message: options.viewModel().statusUpdateError ?? "",
				confirmLabel: "閉じる",
				acknowledgeOnly: true,
				tone: "danger",
			});
		}
		return success;
	};

	/**
	 * その状態へ変えたときに知らせる相手(EvaluationStatus.handoff の to)と、通知メールを送るかの選択。
	 * アプリ内通知は状態の変更と同時に必ず届くので、選べるのはメールのときだけ。初めは「送る」。
	 */
	const mailChoice = (status: EvaluationStatus) => {
		let notify = true;
		const to = status.handoff()?.to;
		const recipient =
			to &&
			{
				subject: `本人（${sheet()?.subject?.name ?? ""}）`,
				primary: `一次評価者（${sheet()?.primaryEvaluator ?? "未設定"}）`,
				secondary: `二次評価者（${sheet()?.secondaryEvaluator ?? "未設定"}）`,
			}[to];
		return {
			checkbox:
				sheet()?.notifiesByMail && recipient
					? {
							label: `${recipient}に通知メールを送る`,
							onChange: (checked: boolean) => {
								notify = checked;
							},
						}
					: undefined,
			notify: () => notify,
		};
	};

	const ensureObjectiveFieldsComplete = () => {
		const missing = sheet()?.pendingObjectiveFields ?? [];
		if (missing.length === 0) {
			return true;
		}
		void confirmAction({
			title: "チャレンジ目標が空欄の目標は送信・確定できません",
			message: `目標は1〜${sheet()?.maxObjectives ?? 0}件必要です。チャレンジ目標を入力して保存するか、不要なタブを削除してください。`,
			details: missing,
			confirmLabel: "閉じる",
			acknowledgeOnly: true,
			tone: "danger",
		});
		return false;
	};

	/** 受け持ち画面では、確定すると次の対象者へ進む。行き先を確認の中で先に知らせる。 */
	const nextNote = () => {
		if (!options.announceNext) {
			return undefined;
		}
		const name = options.announceNext();
		return name
			? `確定後は、次の ${name} さんの評価に進みます。`
			: "自分の番のシートは、これが最後です。";
	};

	const submitGoals = async () => {
		if (!ensureObjectiveFieldsComplete() || !ensureNothingUnsaved()) {
			return;
		}
		const mail = mailChoice(EvaluationStatus.GOALS_SUBMITTED);
		if (
			await confirmAction({
				title: "目標を送信しますか？",
				message:
					"目標を一次評価者へ送信します。一次評価者が要修正として戻すか、目標を確定します。この時点では評価は始まりません。",
				checkbox: mail.checkbox,
				confirmLabel: "目標を送信する",
			})
		) {
			await changeStatus(EvaluationStatus.GOALS_SUBMITTED, "目標を送信しました", mail.notify());
		}
	};

	const returnGoals = async () => {
		if (!ensureNothingUnsaved()) {
			return;
		}
		const mail = mailChoice(EvaluationStatus.DRAFT);
		if (
			(await confirmAction({
				title: "目標を要修正として戻しますか？",
				message: "本人が目標を修正できる下書きへ戻します。本人は修正後にもう一度目標を送信します。",
				checkbox: mail.checkbox,
				confirmLabel: "要修正として戻す",
			})) &&
			(await changeStatus(EvaluationStatus.DRAFT, "下書きに戻しました", mail.notify()))
		) {
			if (options.backToReview) {
				options.backToReview();
			} else {
				options.onStageCompleted?.();
			}
		}
	};

	const confirmGoals = async () => {
		if (!ensureObjectiveFieldsComplete() || !ensureNothingUnsaved()) {
			return;
		}
		const mail = mailChoice(EvaluationStatus.GOALS_CONFIRMED);
		if (
			(await confirmAction({
				title: "目標を確定しますか？",
				message:
					"目標の内容を固定し、本人が達成状況だけを記入できる状態にします。一次評価はまだ始まりません。",
				checkbox: mail.checkbox,
				confirmLabel: "目標を確定する",
			})) &&
			(await changeStatus(EvaluationStatus.GOALS_CONFIRMED, "目標を確定しました", mail.notify()))
		) {
			options.onStageCompleted?.();
		}
	};

	const requestFirst = async () => {
		if (!ensureNothingUnsaved()) {
			return;
		}
		const mail = mailChoice(EvaluationStatus.SUBMITTED);
		if (
			await confirmAction({
				title: "一次評価を依頼しますか？",
				message:
					"保存した達成状況で一次評価を依頼します。依頼後は本人による目標・達成状況の修正はできません。",
				checkbox: mail.checkbox,
				confirmLabel: "一次評価を依頼する",
			})
		) {
			await changeStatus(EvaluationStatus.SUBMITTED, "一次評価を依頼しました", mail.notify());
		}
	};

	const confirmFirst = async () => {
		if (
			!ensureObjectiveFieldsComplete() ||
			!ensureNothingUnsaved() ||
			!options.ensureEvaluationComplete()
		) {
			return;
		}
		const mail = mailChoice(EvaluationStatus.FIRST_EVALUATED);
		if (
			(await confirmAction({
				title: "一次評価を確定しますか？",
				message: `一次評価ランクは ${rankText(sheet()?.firstEvaluationRank)} です。確定すると一次評価は変更できなくなります。この操作は取り消せません。`,
				note: nextNote(),
				checkbox: mail.checkbox,
				confirmLabel: "一次評価を確定する",
				tone: "danger",
			})) &&
			(await changeStatus(
				EvaluationStatus.FIRST_EVALUATED,
				"一次評価を確定しました",
				mail.notify(),
			))
		) {
			options.onStageCompleted?.();
		}
	};

	const finalize = async () => {
		if (
			!ensureObjectiveFieldsComplete() ||
			!ensureNothingUnsaved() ||
			!options.ensureEvaluationComplete()
		) {
			return;
		}
		if (
			(await confirmAction({
				title: "評価を確定しますか？",
				message: `最終評価ランクは ${rankText(sheet()?.finalEvaluationRank)} です。確定すると評価シートはロックされ、本人も評価者も変更できなくなります。この操作は取り消せません。`,
				note: nextNote(),
				confirmLabel: "評価を確定する",
				tone: "danger",
			})) &&
			(await changeStatus(EvaluationStatus.FINALIZED, "評価を確定しました"))
		) {
			options.onStageCompleted?.();
		}
	};

	return { submitGoals, returnGoals, confirmGoals, requestFirst, confirmFirst, finalize };
}
