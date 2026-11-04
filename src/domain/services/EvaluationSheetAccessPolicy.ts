import type { EvaluationSheet } from "../entities/EvaluationSheet";
import type { SheetCorrection } from "../entities/SheetCorrection";
import { err, ok, type Result } from "../Result";
import { isPrimaryEvaluator, isSecondaryEvaluator, isSubject } from "./EvaluatorRoleService";
import type { SheetAccessError } from "./SheetAccessError";

/**
 * 評価シートに対する「誰が・何を・見る/編集できるか」を一箇所に集約したドメインポリシー。
 * 最終評価者は二次評価者。二次評価者を「なし」と明示した社員は、一次評価者が最終評価者を兼ねる
 * (二次評価の入力はなく、一次評価がそのまま最終評価になる)。
 * 二次評価者が未設定なだけの社員には最終評価者がおらず、設定されるまで確定できない。
 * 運用は「目標送信 → 目標確定 → 本人の一次評価依頼 → 一次評価 → 二次評価」の順に進み、
 * 下書き中のシートは評価者に見せない。一次評価は確定すると変更できない。
 * 評価の内容(点数・コメント・総評・ランク・評価点)は、本人には評価確定の後も見せない。最終評価(二次評価・
 * 最終ランク・評価点)を見られるのは最終評価者と管理者だけで、一次評価者は自分の一次評価だけを見る。
 * 異動後の今の評価者(シートの評価者でない人)は、確定したシートの目標を読めるが、評価は見られない。
 * 記入・評価・状態の変更ができるのは、シートの評価期間が実施中の間だけ。締めた期間のシートは、
 * 閲覧と確定済みシートの出力だけになる。締めた期間のシートはもう変わらないので、下書きのままでも
 * 評価者が読める。評価を確定せずに締めてよい期間(Admin が決める)では、確定していないシートも出力できる。
 * 本人・一次評価者・二次評価者の役割はシートごとに解決するため、
 * 「自分が誰かの評価者であり、かつ自分自身の被評価者でもある」場合でも
 * シート間で判定が混ざることはない。
 */
export class EvaluationSheetAccessPolicy {
	private readonly viewerIsFinalEvaluator: boolean;
	/** 評価者として、目標を送信済み(または締めた期間)のシートを見ている。書きかけの下書きは評価者に見せない。 */
	private readonly viewerIsEvaluatorOfSubmittedSheet: boolean;
	/** シートの評価期間が実施中か。締めた期間のシートは誰も変更できない。 */
	private readonly periodIsOpen: boolean;

	private constructor(
		private readonly sheet: EvaluationSheet,
		private readonly viewerIsSubject: boolean,
		private readonly viewerIsPrimaryEvaluator: boolean,
		private readonly viewerIsSecondaryEvaluator: boolean,
		/**
		 * 被評価者の今の評価者(異動で新しく評価者になった人など)として、確定した(または締めた期間の)シートを
		 * 評価の記録として読む。
		 * 読むだけで、帳票と同じ全体が見える。Admin が関わらないシートを見るときも同じ。
		 */
		private readonly viewerReadsRecord = false,
		/** Admin として、自分が本人でも評価者でもないシートを見ている(状態を問わず、読むだけ)。 */
		private readonly viewerIsAdminReader = false,
	) {
		this.periodIsOpen = sheet.evaluationPeriod.isActive;
		this.viewerIsFinalEvaluator =
			viewerIsSecondaryEvaluator || (viewerIsPrimaryEvaluator && sheet.primaryIsFinalEvaluator());
		this.viewerIsEvaluatorOfSubmittedSheet =
			!viewerIsSubject &&
			(viewerIsPrimaryEvaluator || viewerIsSecondaryEvaluator) &&
			(sheet.status.isSentToEvaluators() || !this.periodIsOpen);
	}

	/**
	 * viewerCanViewAllSheets: 見る人が全社のシートを見られる(Admin, canViewAllSheets)か。
	 * 本人・評価者として関わるシートでは、その立場の見え方が優先する(自分の確定前の点数は Admin でも見えない)。
	 */
	static for(
		currentEmployeeId: number | null,
		sheet: EvaluationSheet,
		viewerCanViewAllSheets = false,
	): EvaluationSheetAccessPolicy {
		if (currentEmployeeId === null) {
			return new EvaluationSheetAccessPolicy(sheet, false, false, false);
		}
		const subject = isSubject(currentEmployeeId, sheet.subject);
		const primary = isPrimaryEvaluator(currentEmployeeId, sheet.subject);
		const secondary = isSecondaryEvaluator(currentEmployeeId, sheet.subject);
		const adminReader = viewerCanViewAllSheets && !subject && !primary && !secondary;
		return new EvaluationSheetAccessPolicy(
			sheet,
			subject,
			primary,
			secondary,
			adminReader ||
				(!subject &&
					(sheet.status.isFinalized() || !sheet.evaluationPeriod.isActive) &&
					sheet.currentEvaluatorIds.includes(currentEmployeeId)),
			adminReader,
		);
	}

	/** Admin として、関わらないシートを読み取り専用で見ている。画面はその旨を示し、評価者向けの導線を出さない。 */
	viewsAsAdmin(): boolean {
		return this.viewerIsAdminReader;
	}

	isSubject(): boolean {
		return this.viewerIsSubject;
	}

	/**
	 * アプリ内通知は状態の変更と同時に届くので、再送するのはメールのときだけ。
	 * 再送できるのは、いまの状態へシートを渡した人(EvaluationStatus.handoff の from)で、シートを見られる人。
	 * 要修正で下書きに戻した評価者は、もう見られないので再送できない。
	 */
	canResendNotification(): boolean {
		const from = this.sheet.status.handoff()?.from;
		return (
			this.sheet.notifiesByMail &&
			this.periodIsOpen &&
			this.canViewSheet() &&
			(from === "subject"
				? this.viewerIsSubject
				: from === "primary" && !this.viewerIsSubject && this.viewerIsPrimaryEvaluator)
		);
	}

	canViewSheet(): boolean {
		return this.viewerIsSubject || this.viewerIsEvaluatorOfSubmittedSheet || this.viewerReadsRecord;
	}

	/** 締めた評価期間のシートを変更しようとしたら、役割より先にその理由で止める。 */
	periodOpen(): Result<void, SheetAccessError> {
		return this.periodIsOpen ? ok(undefined) : err({ kind: "periodClosed" });
	}

	// --- チャレンジ目標(Milestone) ---

	/** 目標の文言(チャレンジ目標・期中目標)を編集できるのは、下書きの間の本人だけ。 */
	canEditMilestoneGoal(): boolean {
		return this.periodIsOpen && this.viewerIsSubject && this.sheet.status.isDraft();
	}

	/** 一次評価者は、本人が一次評価を依頼してから一次評価を確定するまで編集できる。 */
	canEditMilestoneFirstScore(): boolean {
		return (
			this.periodIsOpen &&
			!this.viewerIsSubject &&
			this.viewerIsPrimaryEvaluator &&
			this.sheet.status.isAwaitingFirstEvaluation()
		);
	}

	/** 二次評価者は、一次評価が確定してから評価を確定するまで編集できる。 */
	canEditMilestoneSecondScore(): boolean {
		return (
			this.periodIsOpen &&
			!this.viewerIsSubject &&
			this.viewerIsSecondaryEvaluator &&
			this.sheet.status.isAwaitingSecondEvaluation()
		);
	}

	/** 一次評価の点数は、シートの評価者(一次・二次)と管理者だけ。本人には評価確定の後も見せない。 */
	canViewMilestoneFirstScore(): boolean {
		return (
			(!this.viewerIsSubject &&
				(this.viewerIsPrimaryEvaluator || this.viewerIsSecondaryEvaluator)) ||
			this.viewerIsAdminReader
		);
	}

	/** 二次評価の点数は、二次評価者(最終評価者)と管理者だけ。一次評価者と本人には、確定の後も見せない。 */
	canViewMilestoneSecondScore(): boolean {
		return (!this.viewerIsSubject && this.viewerIsSecondaryEvaluator) || this.viewerIsAdminReader;
	}

	// --- 共通評価(CommonEvaluation) ---

	/** 共通評価は、シートの評価者と管理者だけ。本人と、シートの評価者でない今の評価者は見られない。 */
	canViewCommonEvaluation(): boolean {
		return this.viewerIsEvaluatorOfSubmittedSheet || this.viewerIsAdminReader;
	}

	canEditCommonEvaluationFirst(): boolean {
		return this.canEditMilestoneFirstScore();
	}

	canEditCommonEvaluationSecond(): boolean {
		return this.canEditMilestoneSecondScore();
	}

	/** 二次評価の内容は、二次評価者(最終評価者)と管理者だけ。一次評価者は確定の後も見られない。 */
	canViewCommonEvaluationSecond(): boolean {
		return (!this.viewerIsSubject && this.viewerIsSecondaryEvaluator) || this.viewerIsAdminReader;
	}

	// --- 総評・最終評価 ---

	canEditOverallComment(target: "first" | "second"): boolean {
		return target === "first"
			? this.canEditCommonEvaluationFirst()
			: this.canEditCommonEvaluationSecond();
	}

	/**
	 * 評価ランクを出すか。目標の確認中は採点が始まっていないので出さない。ランクも評価の内容なので、
	 * シートの評価者と管理者にだけ出す(本人と、シートの評価者でない今の評価者には出さない)。
	 */
	canViewEvaluationRanks(): boolean {
		return (
			(this.viewerIsEvaluatorOfSubmittedSheet || this.viewerIsAdminReader) &&
			this.sheet.status.isEvaluationStarted()
		);
	}

	/** 評価点・最終評価ランクなど、最終評価の結果を見られるのは最終評価者と管理者だけ。 */
	canViewFinalEvaluation(): boolean {
		return (!this.viewerIsSubject && this.viewerIsFinalEvaluator) || this.viewerIsAdminReader;
	}

	// --- 状態の変更(送信・確定・依頼) ---

	/** 本人は自分の下書きの目標を、一次評価者へ送信できる。 */
	canSubmitGoals(): boolean {
		return this.periodIsOpen && this.viewerIsSubject && this.sheet.status.isDraft();
	}

	/** 一次評価者は送信済みの目標を要修正として下書きに戻せる。 */
	canReturnGoalsToDraft(): boolean {
		return this.canConfirmGoals();
	}

	/** 一次評価者が送信済みの目標を承認する。まだ採点は始めない。 */
	canConfirmGoals(): boolean {
		return (
			this.periodIsOpen &&
			!this.viewerIsSubject &&
			this.viewerIsPrimaryEvaluator &&
			this.sheet.status.isGoalsSubmitted()
		);
	}

	/** 本人は目標確定後に、一次評価を依頼できる。 */
	canRequestFirstEvaluation(): boolean {
		return this.periodIsOpen && this.viewerIsSubject && this.sheet.status.isGoalsConfirmed();
	}

	/**
	 * 達成状況は、一次評価者が目標を確定してから(振り返り待ち)、本人が一次評価を依頼するまでの間だけ書ける。
	 * 確定前の目標に対して実績を書かせない。期中目標の本文は目標確定で固定され、要修正で戻ると直せる。
	 */
	canEditMilestoneAchievement(): boolean {
		return this.periodIsOpen && this.viewerIsSubject && this.sheet.status.isGoalsConfirmed();
	}

	/** 前期のチャレンジ目標を据え置く・見直して引き継ぐのは、目標を書ける下書きの間の本人だけ。 */
	canCarryOverGoal(): boolean {
		return this.canEditMilestoneGoal();
	}

	/**
	 * 一次評価者は一次評価待ちのシートの一次評価を確定し、二次評価者へ引き継げる。確定後は一次評価を変更できない。
	 * 一次評価者が最終評価者を兼ねる社員では、一次評価の確定がそのまま評価の確定(canFinalizeEvaluation)になる。
	 */
	canConfirmFirstEvaluation(): boolean {
		return (
			this.periodIsOpen &&
			!this.viewerIsSubject &&
			this.viewerIsPrimaryEvaluator &&
			!this.sheet.primaryIsFinalEvaluator() &&
			this.sheet.status.isAwaitingFirstEvaluation()
		);
	}

	/**
	 * 最終評価者は、一次評価が確定したシートを確定し、不可逆にロックできる。
	 * 一次評価者が最終評価者を兼ねる社員では、一次評価待ちのシートをそのまま確定する。
	 */
	canFinalizeEvaluation(): boolean {
		return (
			this.periodIsOpen &&
			// 見られるだけ(記録を読む人・Admin)では確定できない。最終評価者本人だけ
			!this.viewerIsSubject &&
			this.viewerIsFinalEvaluator &&
			(this.sheet.status.isAwaitingSecondEvaluation() ||
				(this.sheet.primaryIsFinalEvaluator() && this.sheet.status.isAwaitingFirstEvaluation()))
		);
	}

	// --- 締め後修正(遡及処理) ---

	/**
	 * 締め後修正を見せるか。直した項目そのものを見られる人にだけ見せる(一次評価者に二次評価の修正は見せない、
	 * 本人に確定前の点数の修正は見せない、など)。直したことを隠さないため、見られる項目の修正は必ず見せる。
	 */
	canViewCorrection(correction: SheetCorrection): boolean {
		if (!this.canViewSheet()) {
			return false;
		}
		const { target, value } = correction.field;
		if (correction.stage === "content") {
			return true;
		}
		if (target === "goal") {
			return value === "first_score"
				? this.canViewMilestoneFirstScore()
				: this.canViewMilestoneSecondScore();
		}
		return correction.stage === "first"
			? this.canViewCommonEvaluation()
			: this.canViewCommonEvaluationSecond();
	}

	// --- 出力(PDFエクスポート) ---

	/**
	 * シートの評価者(一次・二次)と管理者が、評価が確定したシートを出力できる。本人は出力できない(評価の内容を
	 * 本人に見せない)。シートの評価者でない今の評価者も出力できない。帳票は見られる範囲だけを載せ、最終評価を
	 * 見られない一次評価者の帳票では、二次評価と最終評価を伏せる。
	 * 評価を確定せずに締めてよい期間では、締めた後なら確定していないシートも出力できる(点数とランクは伏せる)。
	 */
	canExportSheet(): boolean {
		return (
			(this.viewerIsEvaluatorOfSubmittedSheet || this.viewerIsAdminReader) &&
			(this.sheet.status.isFinalized() || this.sheet.evaluationPeriod.allowsExportBeforeFinalized())
		);
	}
}
