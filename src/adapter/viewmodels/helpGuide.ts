import { EvaluationAllocation } from "../../domain/valueObjects/EvaluationAllocation";
import { EvaluationRank } from "../../domain/valueObjects/EvaluationRank";
import {
	EvaluationStatus,
	type EvaluationStatusValue,
	type SheetActor,
} from "../../domain/valueObjects/EvaluationStatus";

/*
 * ヘルプ(導入説明会の資料)の図の元になる事実。状態の順番・担当・通知・書ける時期・ランクの区切りは
 * ドメインの定義から作る。図だけが仕様からずれないよう、ここで組み立ててテストする。
 */

export const ACTOR_LABEL: Record<SheetActor, string> = {
	subject: "本人",
	primary: "一次評価者",
	secondary: "二次評価者",
};

/** その状態へ進める(戻す)ボタン。押す人は EvaluationStatus.movedBy。 */
export const ENTER_ACTION: Record<EvaluationStatusValue, string> = {
	draft: "要修正として下書きに戻す",
	goals_submitted: "目標を送信する",
	goals_confirmed: "目標を確定する",
	submitted: "一次評価を依頼する",
	first_evaluated: "一次評価を確定する",
	finalized: "二次評価を確定する",
};

/** その状態の間に、ボールを持つ人がすること。別の道があれば alt。 */
export const STATE_GUIDE: Record<EvaluationStatusValue, { doing: string; alt?: string }> = {
	draft: {
		doing:
			"本人がチャレンジ目標と期中目標を書きます。要修正で戻ったときは、上部の理由を読んで直します。",
	},
	goals_submitted: {
		doing: "一次評価者が目標を読みます。本人は見るだけです。",
		alt: `直してほしいときは「${ENTER_ACTION.draft}」（理由を添えて）`,
	},
	goals_confirmed: {
		doing: "目標は固定。本人が期中から期末にかけて、達成状況だけを書き足します。",
	},
	submitted: {
		doing: "一次評価者が採点し、項目ごとのコメントと総評を書きます。",
		alt: "二次評価者「なし」の部下は「評価を確定する」でそのまま評価確定",
	},
	first_evaluated: {
		doing: "二次評価者が一次評価を見たうえで採点し直し、総評を書きます。",
	},
	finalized: {
		doing:
			"誰も変更できません。最終評価者と管理者が結果を確かめ、PDF に出力します。評価の内容は本人に公開しません。",
	},
};

/** 次の状態へ進める操作。最後の状態には無い。 */
export const nextStep = (status: EvaluationStatus) => {
	const next = EvaluationStatus.ALL[status.order() + 1];
	return next && { by: next.movedBy(), action: ENTER_ACTION[next.toString()] };
};

/**
 * 「いつ、誰が、何をできるか」の表の行。判定は EvaluationSheetAccessPolicy と同じ状態の判定で、
 * 食い違わないことをテストで確かめる。
 */
export interface WritableRow {
	actor: SheetActor;
	label: string;
	allowed: (status: EvaluationStatus) => boolean;
}

export const WRITABLE_ROWS: readonly WritableRow[] = [
	{ actor: "subject", label: "目標の文言を書く", allowed: (s) => s.isDraft() },
	{ actor: "subject", label: "達成状況を書く", allowed: (s) => s.isGoalsConfirmed() },
	{ actor: "primary", label: "シートを読む", allowed: (s) => s.isSentToEvaluators() },
	{ actor: "primary", label: "目標を確定・差し戻す", allowed: (s) => s.isGoalsSubmitted() },
	{ actor: "primary", label: "一次評価を付ける", allowed: (s) => s.isAwaitingFirstEvaluation() },
	{
		actor: "secondary",
		label: "二次評価を付ける",
		allowed: (s) => s.isAwaitingSecondEvaluation(),
	},
];

/** 通知: その状態へ進んだとき、誰から誰へ、どの操作で届くか(EvaluationStatus.handoff)。 */
export const notices = () =>
	EvaluationStatus.ALL.flatMap((status) => {
		const handoff = status.handoff();
		return handoff ? [{ status, action: ENTER_ACTION[status.toString()], ...handoff }] : [];
	});

/** 説明に使う例: チャレンジ目標1つを 4、共通評価が満点 20 点のうち 17 点。 */
export const SCORE_EXAMPLE = { goal: 4, goalMax: 4, common: 17, commonMax: 20 } as const;

export const scoreExample = (allocation: { objective: number; common: number }) => {
	const objective = EvaluationAllocation.fromTotal(
		allocation.objective,
		SCORE_EXAMPLE.goal,
		SCORE_EXAMPLE.goalMax,
	);
	const common = EvaluationAllocation.fromTotal(
		allocation.common,
		SCORE_EXAMPLE.common,
		SCORE_EXAMPLE.commonMax,
	);
	const total = objective + common;
	return {
		objective,
		common,
		total,
		rank: EvaluationRank.fromScore(total, EvaluationAllocation.TOTAL).toDisplayText(),
	};
};

/** 0〜100 点の帯。低いランクから、区切りの下限と上限を持つ。 */
export const rankBands = () => {
	const bands = [...EvaluationRank.bands()].reverse();
	return bands.map((band, index) => ({
		rank: band.rank.toDisplayText(),
		minimum: band.minimum,
		upper: bands[index + 1]?.minimum ?? EvaluationAllocation.TOTAL,
	}));
};
