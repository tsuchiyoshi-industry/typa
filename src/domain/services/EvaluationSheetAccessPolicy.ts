import type { EvaluationSheet } from "../entities/EvaluationSheet";
import type { EmployeeRole } from "../valueObjects/EmployeeRole";
import { canViewAllSheets } from "./EmployeeMasterAccessService";
import { isPrimaryEvaluator, isSecondaryEvaluator, isSubject } from "./EvaluatorRoleService";

/**
 * 評価シートに対する「誰が・何を・見る/編集できるか」を一箇所に集約したドメインポリシー。
 * 最終評価者は二次評価者。二次評価者を「なし」と明示した社員は、一次評価者が最終評価者を兼ねる
 * (二次評価の入力はなく、一次評価がそのまま最終評価になる)。
 * 二次評価者が未設定なだけの社員には最終評価者がおらず、設定されるまで確定できない。
 * 評価は「提出済み → 一次評価(一次評価者が確定) → 二次評価(最終評価者が確定)」の順に進み、
 * 下書き中のシートは評価者に見せない。一次評価は確定すると変更できない。
 * 記入・評価・状態の変更ができるのは、シートの評価期間が実施中の間だけ。締めた期間のシートは、
 * 閲覧と確定済みシートの出力だけになる。
 * 本人・一次評価者・二次評価者の役割はシートごとに解決するため、
 * 「自分が誰かの評価者であり、かつ自分自身の被評価者でもある」場合でも
 * シート間で判定が混ざることはない。
 * Admin は、他人のシートなら役割がなくても、下書きも含めてすべての内容を閲覧できる(閲覧だけ)。
 * 記入・評価・提出・確定は役割だけで決まり、Admin であることでは増えない。
 * Admin 自身のシートは本人として扱い、自分への評価を先に見ることはできない。
 */
export class EvaluationSheetAccessPolicy {
	private readonly viewerIsFinalEvaluator: boolean;
	/** 評価者として、提出済みのシートを見ている。下書き中は評価者に内容を見せない。 */
	private readonly viewerIsEvaluatorOfSubmittedSheet: boolean;
	/** シートの評価期間が実施中か。締めた期間のシートは誰も変更できない。 */
	private readonly periodIsOpen: boolean;

	private constructor(
		private readonly sheet: EvaluationSheet,
		private readonly viewerIsSubject: boolean,
		private readonly viewerIsPrimaryEvaluator: boolean,
		private readonly viewerIsSecondaryEvaluator: boolean,
		/** Admin として、他人のシートの内容をすべて閲覧できる。何かを変更できるようにはならない。 */
		private readonly viewerReadsEverything: boolean,
	) {
		this.viewerIsFinalEvaluator =
			viewerIsSecondaryEvaluator || (viewerIsPrimaryEvaluator && sheet.primaryIsFinalEvaluator());
		this.viewerIsEvaluatorOfSubmittedSheet =
			!viewerIsSubject &&
			(viewerIsPrimaryEvaluator || viewerIsSecondaryEvaluator) &&
			sheet.status.isSubmitted();
		this.periodIsOpen = sheet.evaluationPeriod.isActive;
	}

	/** viewerRole: 見ている人のアプリの権限。渡さなければ、シート上の役割だけで判定する。 */
	static for(
		currentEmployeeId: number | null,
		sheet: EvaluationSheet,
		viewerRole?: EmployeeRole,
	): EvaluationSheetAccessPolicy {
		if (currentEmployeeId === null) {
			return new EvaluationSheetAccessPolicy(sheet, false, false, false, false);
		}
		const viewerIsSubject = isSubject(currentEmployeeId, sheet.subject);
		return new EvaluationSheetAccessPolicy(
			sheet,
			viewerIsSubject,
			isPrimaryEvaluator(currentEmployeeId, sheet.subject),
			isSecondaryEvaluator(currentEmployeeId, sheet.subject),
			!viewerIsSubject && !!viewerRole && canViewAllSheets(viewerRole),
		);
	}

	isSubject(): boolean {
		return this.viewerIsSubject;
	}

	/** 本人でも評価者でもなく、Admin として閲覧しているだけか。画面で「閲覧のみ」と伝えるのに使う。 */
	isViewingAsAdmin(): boolean {
		return (
			this.viewerReadsEverything &&
			!this.viewerIsPrimaryEvaluator &&
			!this.viewerIsSecondaryEvaluator
		);
	}

	canViewSheet(): boolean {
		return (
			this.viewerIsSubject || this.viewerIsEvaluatorOfSubmittedSheet || this.viewerReadsEverything
		);
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

	/** 一次評価者は二次評価者の評価を見ることができない。 */
	canViewMilestoneSecondScore(): boolean {
		return this.viewerIsSubject || this.viewerIsSecondaryEvaluator || this.viewerReadsEverything;
	}

	// --- 共通評価(CommonEvaluation) ---

	/** 共通評価は評価者と Admin が閲覧できる。本人(被評価者・入力者)は閲覧不可。 */
	canViewCommonEvaluation(): boolean {
		return this.viewerIsEvaluatorOfSubmittedSheet || this.viewerReadsEverything;
	}

	canEditCommonEvaluationFirst(): boolean {
		return this.canEditMilestoneFirstScore();
	}

	canEditCommonEvaluationSecond(): boolean {
		return this.canEditMilestoneSecondScore();
	}

	/** 一次評価者は二次評価の内容を見ることができない(自分の一次評価の出力は可能)。 */
	canViewCommonEvaluationSecond(): boolean {
		return (!this.viewerIsSubject && this.viewerIsSecondaryEvaluator) || this.viewerReadsEverything;
	}

	// --- 総評・最終評価 ---

	canEditOverallComment(target: "first" | "second"): boolean {
		return target === "first"
			? this.canEditCommonEvaluationFirst()
			: this.canEditCommonEvaluationSecond();
	}

	/** 評価点・最終評価ランクなど、最終評価の結果を見られるのは最終評価者と Admin。 */
	canViewFinalEvaluation(): boolean {
		return this.viewerActsAsFinalEvaluator() || this.viewerReadsEverything;
	}

	/** 最終評価者として評価・確定する立場か。見られるだけの Admin は含まない。 */
	private viewerActsAsFinalEvaluator(): boolean {
		return !this.viewerIsSubject && this.viewerIsFinalEvaluator;
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
			this.viewerActsAsFinalEvaluator() &&
			(this.sheet.status.isAwaitingSecondEvaluation() ||
				(this.sheet.primaryIsFinalEvaluator() && this.sheet.status.isAwaitingFirstEvaluation()))
		);
	}

	// --- 出力(PDFエクスポート) ---

	/**
	 * 本人と評価者(一次・二次)、Admin が、評価が確定したシートを出力できる。それ以外の人は出力できない。
	 * 帳票は確定した評価の記録で、誰が出力しても同じ内容になる(画面のように役割で伏せない)。
	 */
	canExportSheet(): boolean {
		return this.canViewSheet() && this.sheet.status.isFinalized();
	}
}
