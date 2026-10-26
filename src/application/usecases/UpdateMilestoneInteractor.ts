import type { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
import { Milestone } from "../../domain/entities/Milestone";
import type { MilestoneError } from "../../domain/entities/MilestoneError";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import type { MilestoneRepository } from "../../domain/repositories/MilestoneRepository";
import { err, ok, type Result } from "../../domain/Result";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import type { SheetAccessError } from "../../domain/services/SheetAccessError";
import type { PeriodGoal } from "../../domain/valueObjects/PeriodGoal";
import { Score } from "../../domain/valueObjects/Score";
import type { MilestoneDto } from "../dtos/MilestoneDto";
import type { OutputPort } from "../ports/OutputPort";
import type { FallibleUseCase } from "../ports/UseCase";
import type { RequestErrorOf } from "./SheetEditError";

/** 書き換える欄。指定しなかった欄は今のまま。 */
export interface MilestoneTextChanges {
	challengeGoal?: string;
	periodGoals?: readonly PeriodGoal[];
	achievement?: string;
}

/**
 * チャレンジ目標への操作は4つで、1回に1つだけ行う。
 * text: 保存済みの目標の文言 / upsertText: その番号の目標に書く(無ければ作る) /
 * score: 評価者の点数 / delete: 本人が目標を消す
 */
export type UpdateMilestoneRequest = { sheetId: number; currentEmployeeId: number } & (
	| ({ action: "text"; milestoneId: number } & MilestoneTextChanges)
	| ({ action: "upsertText"; goalNumber: number } & MilestoneTextChanges)
	| { action: "score"; milestoneId: number; firstScore?: number; secondScore?: number }
	| { action: "delete"; milestoneId: number }
);

/** 目標への操作で起こり得る失敗。 */
export type UpdateMilestoneError =
	| RequestErrorOf<
			| "sheetNotFound"
			| "goalNotOnSheet"
			| "goalNumberInvalid"
			| "tooManyGoals"
			| "lastGoal"
			| "nothingToSave"
			| "scoreOutOfRange"
			| "actionUnknown"
	  >
	| SheetAccessError
	| MilestoneError;

export interface UpdateMilestoneResponse {
	milestone: MilestoneDto;
}

export interface UpdateMilestoneOutputPort extends OutputPort<UpdateMilestoneResponse> {}

type Outcome<T> = Result<T, UpdateMilestoneError>;

/** 書き込む前に、対象・権限・値をすべて確かめる。見せてよい点数は、保存後に読み直したシートで決める。 */
export class UpdateMilestoneInteractor
	implements FallibleUseCase<UpdateMilestoneRequest, UpdateMilestoneOutputPort, UpdateMilestoneError>
{
	constructor(
		private readonly milestoneRepository: MilestoneRepository,
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
	) {}

	async execute(
		request: UpdateMilestoneRequest,
		outputPort: UpdateMilestoneOutputPort,
	): Promise<Outcome<void>> {
		const sheet = await this.evaluationSheetRepository.findById(request.sheetId);
		if (!sheet) {
			return err({ kind: "sheetNotFound" });
		}
		const policy = EvaluationSheetAccessPolicy.for(request.currentEmployeeId, sheet);
		const open = policy.periodOpen();
		if (!open.ok) {
			return open;
		}

		const milestone = await this.apply(sheet, policy, request);
		if (!milestone.ok) {
			return milestone;
		}
		const saved = milestone.value;
		outputPort.present({
			milestone: {
				id: saved.id,
				sheetId: saved.sheetId,
				goalNumber: saved.goalNumber,
				challengeGoal: saved.challengeGoal,
				periodGoals: saved.periodGoals,
				achievement: saved.achievement,
				firstScore: policy.canViewMilestoneFirstScore() ? saved.firstScore.toNumber() : null,
				secondScore: policy.canViewMilestoneSecondScore() ? saved.secondScore.toNumber() : null,
			},
		});
		return ok(undefined);
	}

	private apply(
		sheet: EvaluationSheet,
		policy: EvaluationSheetAccessPolicy,
		request: UpdateMilestoneRequest,
	): Promise<Outcome<Milestone>> {
		switch (request.action) {
			case "delete":
				return this.delete(sheet, policy, request.milestoneId);
			case "score":
				return this.score(sheet, policy, request);
			case "text": {
				const target = objectiveOf(sheet, request.milestoneId);
				return target.ok
					? this.text(sheet, policy, target.value, request)
					: Promise.resolve(target);
			}
			case "upsertText": {
				const slot = slotOf(sheet, request.goalNumber);
				return slot.ok ? this.text(sheet, policy, slot.value, request) : Promise.resolve(slot);
			}
			default:
				return Promise.resolve(err({ kind: "actionUnknown" }));
		}
	}

	private async delete(
		sheet: EvaluationSheet,
		policy: EvaluationSheetAccessPolicy,
		milestoneId: number,
	): Promise<Outcome<Milestone>> {
		const target = objectiveOf(sheet, milestoneId);
		if (!target.ok) {
			return target;
		}
		if (!policy.canEditMilestoneGoal()) {
			return err({ kind: "forbidden", action: "deleteGoal" });
		}
		if (sheet.objectives.length <= 1) {
			return err({ kind: "lastGoal" });
		}
		await this.milestoneRepository.delete(target.value.id);
		return target;
	}

	private async score(
		sheet: EvaluationSheet,
		policy: EvaluationSheetAccessPolicy,
		request: { milestoneId: number; firstScore?: number; secondScore?: number },
	): Promise<Outcome<Milestone>> {
		const target = objectiveOf(sheet, request.milestoneId);
		if (!target.ok) {
			return target;
		}
		const { firstScore, secondScore } = request;
		if (firstScore === undefined && secondScore === undefined) {
			return err({ kind: "nothingToSave" });
		}
		if ([firstScore, secondScore].some((score) => score !== undefined && !Score.isValid(score))) {
			return err({ kind: "scoreOutOfRange" });
		}
		if (firstScore !== undefined && !policy.canEditMilestoneFirstScore()) {
			return err({ kind: "forbidden", action: "editFirstScore" });
		}
		if (secondScore !== undefined && !policy.canEditMilestoneSecondScore()) {
			return err({ kind: "forbidden", action: "editSecondScore" });
		}
		await this.milestoneRepository.updateScore(target.value.id, firstScore, secondScore);
		return ok(await this.reload(sheet, (objective) => objective.id === target.value.id));
	}

	private async text(
		sheet: EvaluationSheet,
		policy: EvaluationSheetAccessPolicy,
		current: Milestone,
		changes: MilestoneTextChanges & { action: "text" | "upsertText" },
	): Promise<Outcome<Milestone>> {
		const { challengeGoal, periodGoals, achievement } = changes;
		if (challengeGoal === undefined && periodGoals === undefined && achievement === undefined) {
			return err({ kind: "nothingToSave" });
		}
		// 書いてよい欄と、書いた後の目標が正しいかは Milestone が確かめる
		let next: Result<Milestone, MilestoneError>;
		if (policy.canEditMilestoneGoal()) {
			next = current.withTextUpdates({ challengeGoal, periodGoals, achievement });
		} else if (policy.canEditMilestoneAchievement() && current.id > 0) {
			next = current.withAchievementUpdates({ challengeGoal, periodGoals, achievement });
		} else {
			return err({ kind: "forbidden", action: "editGoalText" });
		}
		if (!next.ok) {
			return next;
		}

		const text = [next.value.challengeGoal, next.value.periodGoals, next.value.achievement] as const;
		if (changes.action === "text") {
			await this.milestoneRepository.updateText(current.id, ...text);
			return ok(await this.reload(sheet, (objective) => objective.id === current.id));
		}
		// (シート, 目標番号) の一意制約で、あれば更新・なければ追加する
		await this.milestoneRepository.upsertText(sheet.sheetId, current.goalNumber, ...text);
		return ok(await this.reload(sheet, (objective) => objective.goalNumber === current.goalNumber));
	}

	/**
	 * 保存後に読み直したシートから、保存した目標を取り出す(見せてよい点数は DB が決める)。
	 * 書けたのに読めないのは想定外なので、例外にする。
	 */
	private async reload(
		sheet: EvaluationSheet,
		isSaved: (objective: Milestone) => boolean,
	): Promise<Milestone> {
		const saved = (await this.evaluationSheetRepository.findById(sheet.sheetId))?.objectives.find(
			isSaved,
		);
		if (!saved) {
			throw new Error("保存した目標を読み込めませんでした。");
		}
		return saved;
	}
}

/** このシートの目標。ほかのシートの目標 ID は受け付けない。 */
function objectiveOf(sheet: EvaluationSheet, milestoneId: number): Outcome<Milestone> {
	const objective = sheet.objectives.find((candidate) => candidate.id === milestoneId);
	return objective ? ok(objective) : err({ kind: "goalNotOnSheet" });
}

/** その番号の目標。まだ無ければ、上限の内側で新しく作る目標(id 0)。 */
function slotOf(sheet: EvaluationSheet, goalNumber: number): Outcome<Milestone> {
	if (!Number.isSafeInteger(goalNumber) || goalNumber < 1 || goalNumber > sheet.maxObjectives) {
		return err({ kind: "goalNumberInvalid" });
	}
	const existing = sheet.objectives.find((objective) => objective.goalNumber === goalNumber);
	if (existing) {
		return ok(existing);
	}
	if (sheet.objectives.length >= sheet.maxObjectives) {
		return err({ kind: "tooManyGoals", max: sheet.maxObjectives });
	}
	return Milestone.from({ id: 0, sheetId: sheet.sheetId, goalNumber, challengeGoal: "" });
}
