import type { EvaluationSheet } from "../entities/EvaluationSheet";
import { isPrimaryEvaluator, isSecondaryEvaluator, isSubject } from "./EvaluatorRoleService";

/**
 * 評価シートに対する「誰が・何を・見る/編集できるか」を一箇所に集約したドメインポリシー。
 * 最終評価者は二次評価者。二次評価者を「なし」と明示した社員は、一次評価者が最終評価者を兼ねる
 * (二次評価の入力はなく、一次評価がそのまま最終評価になる)。
 * 二次評価者が未設定なだけの社員には最終評価者がおらず、設定されるまで確定できない。
 * 本人・一次評価者・二次評価者の役割はシートごとに解決するため、
 * 「自分が誰かの評価者であり、かつ自分自身の被評価者でもある」場合でも
 * シート間で判定が混ざることはない。
 */
export class EvaluationSheetAccessPolicy {
	private readonly viewerIsFinalEvaluator: boolean;

	private constructor(
		private readonly sheet: EvaluationSheet,
		private readonly viewerIsSubject: boolean,
		private readonly viewerIsPrimaryEvaluator: boolean,
		private readonly viewerIsSecondaryEvaluator: boolean,
	) {
		this.viewerIsFinalEvaluator =
			viewerIsSecondaryEvaluator || (viewerIsPrimaryEvaluator && sheet.primaryIsFinalEvaluator());
	}

	static for(
		currentEmployeeId: number | null,
		sheet: EvaluationSheet,
	): EvaluationSheetAccessPolicy {
		if (currentEmployeeId === null) {
			return new EvaluationSheetAccessPolicy(sheet, false, false, false);
		}
		return new EvaluationSheetAccessPolicy(
			sheet,
			isSubject(currentEmployeeId, sheet.subject),
			isPrimaryEvaluator(currentEmployeeId, sheet.subject),
			isSecondaryEvaluator(currentEmployeeId, sheet.subject),
		);
	}

	isSubject(): boolean {
		return this.viewerIsSubject;
	}

	canViewSheet(): boolean {
		return this.viewerIsSubject || this.viewerIsPrimaryEvaluator || this.viewerIsSecondaryEvaluator;
	}

	// --- チャレンジ目標(Milestone) ---

	/** 目標文言(チャレンジ目標・中間目標・達成状況)を編集できるのは本人のみ。 */
	canEditMilestoneGoal(): boolean {
		return this.viewerIsSubject && this.sheet.isEditable();
	}

	/** 評価者は下書き中は閲覧のみで、本人が提出してから評価を編集できる。 */
	canEditMilestoneFirstScore(): boolean {
		return (
			!this.viewerIsSubject &&
			this.viewerIsPrimaryEvaluator &&
			this.sheet.status.isUnderEvaluation()
		);
	}

	canEditMilestoneSecondScore(): boolean {
		return (
			!this.viewerIsSubject &&
			this.viewerIsSecondaryEvaluator &&
			this.sheet.status.isUnderEvaluation()
		);
	}

	/** 一次評価者は二次評価者の評価を見ることができない。 */
	canViewMilestoneSecondScore(): boolean {
		return this.viewerIsSubject || this.viewerIsSecondaryEvaluator;
	}

	// --- 共通評価(CommonEvaluation) ---

	/** 共通評価は評価者のみ閲覧可能。本人(被評価者・入力者)は閲覧不可。 */
	canViewCommonEvaluation(): boolean {
		return (
			!this.viewerIsSubject && (this.viewerIsPrimaryEvaluator || this.viewerIsSecondaryEvaluator)
		);
	}

	/** 評価者は下書き中は閲覧のみで、本人が提出してから評価を編集できる。 */
	canEditCommonEvaluationFirst(): boolean {
		return (
			!this.viewerIsSubject &&
			this.viewerIsPrimaryEvaluator &&
			this.sheet.status.isUnderEvaluation()
		);
	}

	canEditCommonEvaluationSecond(): boolean {
		return (
			!this.viewerIsSubject &&
			this.viewerIsSecondaryEvaluator &&
			this.sheet.status.isUnderEvaluation()
		);
	}

	/** 一次評価者は二次評価の内容を見ることができない(自分の一次評価の出力は可能)。 */
	canViewCommonEvaluationSecond(): boolean {
		return !this.viewerIsSubject && this.viewerIsSecondaryEvaluator;
	}

	// --- 総評・最終評価ランク ---

	canEditOverallComment(target: "first" | "second"): boolean {
		return target === "first"
			? this.canEditCommonEvaluationFirst()
			: this.canEditCommonEvaluationSecond();
	}

	canDecideFinalEvaluationRank(): boolean {
		return this.canFinalizeEvaluation();
	}

	/** 評価点・最終評価ランクなど、最終評価の結果を見られるのは最終評価者のみ。 */
	canViewFinalEvaluation(): boolean {
		return !this.viewerIsSubject && this.viewerIsFinalEvaluator;
	}

	// --- シートロック(提出・確定) ---

	/** 本人は自分の下書きを提出できる。 */
	canSubmitOwnSheet(): boolean {
		return this.viewerIsSubject && this.sheet.status.isDraft();
	}

	/** 本人は提出済み(二次評価未確定)を下書きに戻せる。二次評価確定後は不可。 */
	canRevertOwnSheetToDraft(): boolean {
		return this.viewerIsSubject && this.sheet.status.isUnderEvaluation();
	}

	/** 最終評価者は評価入力段階(提出済み・未確定)のシートを確定し、不可逆にロックできる。 */
	canFinalizeEvaluation(): boolean {
		return this.canViewFinalEvaluation() && this.sheet.status.isUnderEvaluation();
	}

	canChangeStatusTo(targetSubmitted: boolean): boolean {
		return targetSubmitted
			? this.canSubmitOwnSheet() || this.canFinalizeEvaluation()
			: this.canRevertOwnSheetToDraft();
	}

	// --- 出力(PDFエクスポート) ---

	/** 被評価者は出力できない。評価者(一次・二次)のみ出力できる。 */
	canExportSheet(): boolean {
		return (
			!this.viewerIsSubject && (this.viewerIsPrimaryEvaluator || this.viewerIsSecondaryEvaluator)
		);
	}

	/** 最終評価者ではない一次評価者向けの出力では、二次評価と最終評価の内容をすべて伏せる。 */
	canExportSecondEvaluation(): boolean {
		return this.canViewFinalEvaluation();
	}
}
