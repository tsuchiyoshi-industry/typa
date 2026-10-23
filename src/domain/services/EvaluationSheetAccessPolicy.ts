import type { EvaluationSheet } from "../entities/EvaluationSheet";
import type { SheetCorrection } from "../entities/SheetCorrection";
import { isPrimaryEvaluator, isSecondaryEvaluator, isSubject } from "./EvaluatorRoleService";

/**
 * 評価シートに対する「誰が・何を・見る/編集できるか」を一箇所に集約したドメインポリシー。
 * 最終評価者は二次評価者。二次評価者を「なし」と明示した社員は、一次評価者が最終評価者を兼ねる
 * (二次評価の入力はなく、一次評価がそのまま最終評価になる)。
 * 二次評価者が未設定なだけの社員には最終評価者がおらず、設定されるまで確定できない。
 * 評価は「提出済み → 一次評価(一次評価者が確定) → 二次評価(最終評価者が確定)」の順に進み、
 * 下書き中のシートは評価者に見せない。一次評価は確定すると変更できない。
 * 記入・評価・状態の変更ができるのは、シートの評価期間が実施中の間だけ。締めた期間のシートは、
 * 閲覧と確定済みシートの出力だけになる。締めた期間のシートはもう変わらないので、下書きのままでも
 * 評価者が読める。評価を確定せずに締めてよい期間(Admin が決める)では、確定していないシートも出力できる。
 * 本人・一次評価者・二次評価者の役割はシートごとに解決するため、
 * 「自分が誰かの評価者であり、かつ自分自身の被評価者でもある」場合でも
 * シート間で判定が混ざることはない。
 */
export class EvaluationSheetAccessPolicy {
	private readonly viewerIsFinalEvaluator: boolean;
	/** 評価者として、提出済み(または締めた期間)のシートを見ている。書きかけの下書きは評価者に見せない。 */
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
		 * 読むだけで、帳票と同じ全体が見える。
		 */
		private readonly viewerReadsRecord = false,
	) {
		this.periodIsOpen = sheet.evaluationPeriod.isActive;
		this.viewerIsFinalEvaluator =
			viewerIsSecondaryEvaluator || (viewerIsPrimaryEvaluator && sheet.primaryIsFinalEvaluator());
		this.viewerIsEvaluatorOfSubmittedSheet =
			!viewerIsSubject &&
			(viewerIsPrimaryEvaluator || viewerIsSecondaryEvaluator) &&
			(sheet.status.isSubmitted() || !this.periodIsOpen);
	}

	static for(
		currentEmployeeId: number | null,
		sheet: EvaluationSheet,
	): EvaluationSheetAccessPolicy {
		if (currentEmployeeId === null) {
			return new EvaluationSheetAccessPolicy(sheet, false, false, false);
		}
		const subject = isSubject(currentEmployeeId, sheet.subject);
		return new EvaluationSheetAccessPolicy(
			sheet,
			subject,
			isPrimaryEvaluator(currentEmployeeId, sheet.subject),
			isSecondaryEvaluator(currentEmployeeId, sheet.subject),
			!subject &&
				(sheet.status.isFinalized() || !sheet.evaluationPeriod.isActive) &&
				sheet.currentEvaluatorIds.includes(currentEmployeeId),
		);
	}

	isSubject(): boolean {
		return this.viewerIsSubject;
	}

	canResendNotification(): boolean {
		return (
			this.periodIsOpen &&
			((this.viewerIsSubject && this.sheet.status.isAwaitingFirstEvaluation()) ||
				(!this.viewerIsSubject &&
					this.viewerIsPrimaryEvaluator &&
					this.sheet.status.isAwaitingSecondEvaluation()))
		);
	}

	canViewSheet(): boolean {
		return this.viewerIsSubject || this.viewerIsEvaluatorOfSubmittedSheet || this.viewerReadsRecord;
	}

	/** 締めた評価期間のシートを変更しようとしたら、役割より先にその理由で止める。 */
	assertPeriodOpen(): void {
		if (!this.periodIsOpen) {
			throw new Error(
				"この評価期間は締められているため、評価シートを変更できません。変更が必要な場合は、TYPA の管理担当者に連絡してください。",
			);
		}
	}

	// --- チャレンジ目標(Milestone) ---

	/** 目標文言(チャレンジ目標・中間目標・達成状況)を編集できるのは本人のみ。 */
	canEditMilestoneGoal(): boolean {
		return this.periodIsOpen && this.viewerIsSubject && this.sheet.isEditable();
	}

	/** 一次評価者は、本人の提出後から一次評価を確定するまで編集できる。 */
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

	/** 本人は評価が確定するまで点数を見られない(評価者が保存しただけの途中の点数を見せない)。 */
	canViewMilestoneFirstScore(): boolean {
		return !this.viewerIsSubject || this.sheet.status.isFinalized();
	}

	/** 一次評価者は二次評価者の評価を見ることができない。本人は評価が確定してから見られる。 */
	canViewMilestoneSecondScore(): boolean {
		return (
			(this.viewerIsSubject && this.sheet.status.isFinalized()) ||
			this.viewerIsSecondaryEvaluator ||
			this.viewerReadsRecord
		);
	}

	// --- 共通評価(CommonEvaluation) ---

	/** 共通評価は評価者のみ閲覧可能。本人(被評価者・入力者)は閲覧不可。 */
	canViewCommonEvaluation(): boolean {
		return this.viewerIsEvaluatorOfSubmittedSheet || this.viewerReadsRecord;
	}

	canEditCommonEvaluationFirst(): boolean {
		return this.canEditMilestoneFirstScore();
	}

	canEditCommonEvaluationSecond(): boolean {
		return this.canEditMilestoneSecondScore();
	}

	/** 一次評価者は二次評価の内容を見ることができない(自分の一次評価の出力は可能)。 */
	canViewCommonEvaluationSecond(): boolean {
		return (!this.viewerIsSubject && this.viewerIsSecondaryEvaluator) || this.viewerReadsRecord;
	}

	// --- 総評・最終評価 ---

	canEditOverallComment(target: "first" | "second"): boolean {
		return target === "first"
			? this.canEditCommonEvaluationFirst()
			: this.canEditCommonEvaluationSecond();
	}

	/** 評価点・最終評価ランクなど、最終評価の結果を見られるのは最終評価者のみ。 */
	canViewFinalEvaluation(): boolean {
		return (!this.viewerIsSubject && this.viewerIsFinalEvaluator) || this.viewerReadsRecord;
	}

	// --- シートロック(提出・確定) ---

	/** 本人は自分の下書きを提出できる。 */
	canSubmitOwnSheet(): boolean {
		return this.periodIsOpen && this.viewerIsSubject && this.sheet.status.isDraft();
	}

	/** 本人は一次評価が確定するまで、提出済みを下書きに戻せる。 */
	canRevertOwnSheetToDraft(): boolean {
		return (
			this.periodIsOpen && this.viewerIsSubject && this.sheet.status.isAwaitingFirstEvaluation()
		);
	}

	/**
	 * 一次評価者は提出済みのシートの一次評価を確定し、二次評価者へ引き継げる。確定後は一次評価を変更できない。
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
	 * 一次評価者が最終評価者を兼ねる社員では、提出済みのシートをそのまま確定する。
	 */
	canFinalizeEvaluation(): boolean {
		return (
			this.periodIsOpen &&
			this.canViewFinalEvaluation() &&
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
	 * 本人と評価者(一次・二次)が、評価が確定したシートを出力できる。評価関係のない人は出力できない。
	 * 帳票は確定した評価の記録で、誰が出力しても同じ内容になる(画面のように役割で伏せない)。
	 * 評価を確定せずに締めてよい期間では、締めた後なら確定していないシートも出力できる(点数とランクは伏せる)。
	 */
	canExportSheet(): boolean {
		return (
			this.canViewSheet() &&
			(this.sheet.status.isFinalized() || this.sheet.evaluationPeriod.allowsExportBeforeFinalized())
		);
	}
}
