import type { ChallengeEvaluationController } from "../adapter/controllers/ChallengeEvaluationController";
import type { CommonEvaluationController } from "../adapter/controllers/CommonEvaluationController";
import type { SheetEditorController } from "../adapter/controllers/SheetEditorController";
import { createChallengeEvaluationPresenter } from "../adapter/presenters/ChallengeEvaluationPresenter";
import { createCommonEvaluationPresenter } from "../adapter/presenters/CommonEvaluationPresenter";
import { createSheetEditorPresenter } from "../adapter/presenters/SheetEditorPresenter";
import {
	finalScore,
	reviewRank,
	reviewScore,
	sheetStatus,
} from "../adapter/viewmodels/reviewerWorkspace";
import type { SheetEditorViewProps } from "../adapter/views/SheetEditorView";
import type { EvaluationSheetDto } from "../application/dtos/EvaluationSheetDto";
import type { ReviewerRowDto } from "../application/dtos/ReviewerWorkspaceDto";
import { EvaluationStatus } from "../domain/valueObjects/EvaluationStatus";

/** Real editor/presenters, a deterministic in-memory transport for UI verification. */
export function reviewerEditorFixture(
	getRows: () => ReviewerRowDto[],
	changed?: () => void,
): SheetEditorViewProps {
	const presenter = createSheetEditorPresenter();
	const common = createCommonEvaluationPresenter();
	const challenge = createChallengeEvaluationPresenter();
	const find = (id: number) => {
		const row = getRows().find((row) => row.sheetId === id);
		if (!row) {
			throw new Error("評価シートがありません。");
		}
		return row;
	};
	const dto = (row: ReviewerRowDto): EvaluationSheetDto => ({
		sheetId: row.sheetId as number,
		subject: {
			id: row.employeeId,
			name: row.employeeName,
			employeeNo: row.employeeNo,
			roleId: 2,
			careerCourse: row.careerCourse,
			gradeId: row.gradeId,
			gradeName: row.gradeName,
			primaryEvaluatorId: 2,
			secondaryEvaluatorId: 3,
		},
		evaluationPeriod: {
			id: 10,
			periodName: "2026年度 下期",
			startDate: "2026-10-01",
			endDate: "2027-03-31",
			isActive: true,
		},
		primaryEvaluator: row.primaryEvaluator,
		secondaryEvaluator: "徳永 優",
		primaryIsFinalEvaluator: row.primaryIsFinal,
		firstOverallComment: row.firstOverallComment,
		secondOverallComment: row.secondOverallComment ?? "",
		objectives: row.objectives.map((goal) => ({
			...goal,
			sheetId: row.sheetId as number,
			midtermGoal: "中間面談で達成状況を確認",
		})),
		maxObjectives: 4,
		objectiveScoreTotals: {
			firstTotalScore: 2,
			firstTotalRate: 50,
			secondTotalScore: 3,
			secondTotalRate: 75,
		},
		commonEvaluationScoreTotals: {
			firstTotalScore: 3,
			firstTotalRate: 60,
			secondTotalScore: 4,
			secondTotalRate: 80,
		},
		allocatedScores: {
			objectiveAllocationScore: 20,
			objectiveSecondRate: 75,
			objectiveEvaluationScore: 15,
			commonEvaluationAllocationScore: 80,
			commonEvaluationSecondRate: 80,
			commonEvaluationEvaluationScore: 64,
			totalEvaluationScore: finalScore(row),
		},
		status: EvaluationStatus.from(row.status).toString(),
		isEditable: false,
		pendingEvaluationItems: (() => {
			const score = row.status === "submitted" ? "firstScore" : "secondScore";
			return [
				...row.objectives
					.filter((goal) => goal[score] === 0)
					.map((goal) => `チャレンジ目標 ${goal.goalNumber}`),
				...row.commonItems
					.filter((item) => item[score] === 0)
					.map((item) => `共通評価「${item.title}」`),
			];
		})(),
		firstEvaluationRank: {
			displayText: reviewRank(row, "first")?.text ?? "D",
			score: reviewScore(row, "first") ?? 0,
			confirmed: row.firstRank !== null,
		},
		finalEvaluationRank: row.canViewFinal
			? {
					displayText: reviewRank(row, "final")?.text ?? "D",
					score: finalScore(row) ?? 0,
					confirmed: !!sheetStatus(row)?.isFinalized(),
				}
			: undefined,
	});
	const touch = (_row: ReviewerRowDto) => {
		changed?.();
	};
	const canConfirmFirst = (row: ReviewerRowDto) =>
		row.isPrimary && !row.primaryIsFinal && !!sheetStatus(row)?.isAwaitingFirstEvaluation();
	const canFinalize = (row: ReviewerRowDto) =>
		row.canViewFinal &&
		(!!sheetStatus(row)?.isAwaitingSecondEvaluation() ||
			(row.primaryIsFinal && !!sheetStatus(row)?.isAwaitingFirstEvaluation()));
	const controller = {
		async loadSheet(id: number, silent = false) {
			presenter.beginSheetLoad(silent);
			presenter.outputPort.sheet.present(dto(find(id)));
			return id;
		},
		async loadRoles(id: number) {
			const row = find(id);
			presenter.outputPort.role.present({
				isSubject: false,
				viewingAsAdmin: false,
				canEditFirst: row.isPrimary && !!sheetStatus(row)?.isAwaitingFirstEvaluation(),
				canEditSecond: row.canViewSecond && !!sheetStatus(row)?.isAwaitingSecondEvaluation(),
				canEditMilestoneGoal: false,
				canViewCommonEvaluation: true,
				canViewSecondEvaluation: row.canViewSecond,
				canSubmitOwnSheet: false,
				canRevertOwnSheetToDraft: false,
				canConfirmFirstEvaluation: canConfirmFirst(row),
				canFinalizeEvaluation: canFinalize(row),
			});
		},
		async updateOverallComment(target: "first" | "second", comment: string) {
			const row = find(presenter.viewModel().sheet?.sheetId as number);
			if (target === "first") {
				row.firstOverallComment = comment;
			} else {
				row.secondOverallComment = comment;
			}
			touch(row);
			presenter.outputPort.sheet.present(dto(row));
			return true;
		},
		async updateStatus(status: EvaluationStatus) {
			const row = find(presenter.viewModel().sheet?.sheetId as number);
			if (status === EvaluationStatus.FIRST_EVALUATED && canConfirmFirst(row)) {
				row.firstRank = reviewRank(row, "first")?.text ?? null;
				row.status = status.toString();
			} else if (status === EvaluationStatus.FINALIZED && canFinalize(row)) {
				row.finalRank = reviewRank(row, "final")?.text ?? null;
				row.finalScore = finalScore(row);
				row.status = status.toString();
			} else {
				return false;
			}
			touch(row);
			presenter.outputPort.sheet.present(dto(row));
			return true;
		},
	} as unknown as SheetEditorController;
	const commonController = {
		async load(id: number) {
			const row = find(id);
			const totalWeight = row.commonItems.reduce((sum, item) => sum + item.weight, 0);
			const totalFirstScore = row.commonItems.reduce((sum, item) => sum + item.firstScore, 0);
			const totalSecondScore = row.commonItems.reduce(
				(sum, item) => sum + (item.secondScore ?? 0),
				0,
			);
			common.outputPort.load.present({
				results: row.commonItems.map((item) => ({
					id: item.id,
					sheetId: id,
					itemId: item.id,
					firstScore: item.firstScore,
					secondScore: item.secondScore,
					firstComment: item.firstComment,
					item: {
						id: item.id,
						title: item.title,
						description: "日々の業務における遂行力・品質・改善への取り組み",
						weight: item.weight,
						itemSetId: 1,
					},
				})),
				totalFirstScore,
				totalSecondScore,
				totalWeight,
				firstRate: totalWeight ? Math.round((totalFirstScore / totalWeight) * 100) : 0,
				secondRate: totalWeight ? Math.round((totalSecondScore / totalWeight) * 100) : 0,
			});
		},
		async upsert(
			id: number,
			results: { itemId: number; firstScore: number; secondScore: number; firstComment: string }[],
		) {
			const row = find(id);
			for (const item of row.commonItems) {
				const result = results.find((entry) => entry.itemId === item.id);
				if (result) {
					Object.assign(item, result);
				}
			}
			touch(row);
			return true;
		},
	} as unknown as CommonEvaluationController;
	const challengeController = {
		async updateScore(id: number, goalId: number, firstScore?: number, secondScore?: number) {
			const row = find(id);
			const goal = row.objectives.find((goal) => goal.id === goalId);
			if (goal) {
				if (firstScore !== undefined) {
					goal.firstScore = firstScore;
				}
				if (secondScore !== undefined) {
					goal.secondScore = secondScore;
				}
			}
			touch(row);
			return true;
		},
	} as unknown as ChallengeEvaluationController;
	return {
		controller,
		viewModel: presenter.viewModel,
		commonEvaluationController: commonController,
		commonEvaluationViewModel: common.viewModel,
		challengeEvaluationController: challengeController,
		challengeEvaluationViewModel: challenge.viewModel,
	};
}
