import {
	type CommonGoalDraft,
	type CommonGoalSet,
	CommonGoalSetChange,
	canDeleteCommonGoalSet,
	canDeleteGrade,
	GRADE_MASTER_LIMITS,
	GradeChange,
	type GradeEntry,
	type GradeMaster,
	type GradeMasterError,
} from "../../domain/entities/GradeMaster";
import { err, ok, type Result } from "../../domain/Result";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { GradeMasterRepository } from "../../domain/repositories/GradeMasterRepository";
import { canManageGradeMaster } from "../../domain/services/EmployeeMasterAccessService";
import type { OutputPort } from "../ports/OutputPort";
import type { FallibleUseCase } from "../ports/UseCase";

const { name, title, description, items, weight } = GRADE_MASTER_LIMITS;

export function describeGradeMasterError(error: GradeMasterError): string {
	switch (error.kind) {
		case "forbidden":
			return "等級と共通目標のマスタは Admin のみ利用できます。";
		case "nameInvalid":
			return `等級名を ${name} 文字以内で入力してください。`;
		case "itemSetRequired":
			return "この等級の共通目標を選んでください。";
		case "gradeInUse":
			return error.employees > 0
				? `この等級の社員が ${error.employees} 人います。先に社員マスタで等級を変えてください。`
				: `この等級で作られた評価シートが ${error.sheets} 枚あります。シートの記録に使うため削除できません。`;
		case "setNameInvalid":
			return `共通目標の名前を ${name} 文字以内で入力してください。`;
		case "itemsRequired":
			return "共通目標の項目を 1 件以上入力してください。";
		case "tooManyItems":
			return `共通目標の項目は ${items} 件までです。`;
		case "titleInvalid":
			return `${error.row} 行目: 項目名を ${title} 文字以内で入力してください。`;
		case "descriptionTooLong":
			return `${error.row} 行目: 説明は ${description} 文字以内で入力してください。`;
		case "weightInvalid":
			return `${error.row} 行目: 重みは ${weight.min}〜${weight.max} の整数で入力してください。`;
		case "duplicateTitle":
			return `項目名「${error.title}」が重複しています。`;
		case "setInUse":
			return error.grades.length > 0
				? `この共通目標は等級(${error.grades.join("・")})が使っています。先に等級の共通目標を変えてください。`
				: `この共通目標で作られた評価シートが ${error.sheets} 枚あります。シートの記録に使うため削除できません。`;
	}
}

type Employees = Pick<EmployeeMasterRepository, "findCurrentEmployeeProfile">;

/** 利用中の Admin か。違えば何も読まず・書かずに断る(URL を直接開いたときも)。 */
abstract class GradeMasterUseCase {
	constructor(
		protected readonly repository: GradeMasterRepository,
		private readonly employees: Employees,
	) {}

	protected async allowed(): Promise<boolean> {
		const actor = await this.employees.findCurrentEmployeeProfile();
		return !!actor?.enabled && canManageGradeMaster(actor.role);
	}
}

const forbidden = err({ kind: "forbidden" } as const);

export class LoadGradeMasterInteractor
	extends GradeMasterUseCase
	implements FallibleUseCase<undefined, OutputPort<GradeMaster>, GradeMasterError>
{
	async execute(
		_: undefined,
		output: OutputPort<GradeMaster>,
	): Promise<Result<void, GradeMasterError>> {
		if (!(await this.allowed())) {
			return forbidden;
		}
		output.present(await this.repository.load());
		return ok(undefined);
	}
}

export interface SaveEmployeeGradeRequest {
	name: string;
	itemSetId: number | null;
	/** 変更するときは画面に出していた等級。追加は null。 */
	shown: GradeEntry | null;
}

export interface SavedResponse {
	id: number;
	message: string;
}

/** 等級の追加・変更。共通目標を付け替えても、作成済みのシートは作成時の共通目標のまま。 */
export class SaveEmployeeGradeInteractor
	extends GradeMasterUseCase
	implements FallibleUseCase<SaveEmployeeGradeRequest, OutputPort<SavedResponse>, GradeMasterError>
{
	async execute(
		request: SaveEmployeeGradeRequest,
		output: OutputPort<SavedResponse>,
	): Promise<Result<void, GradeMasterError>> {
		if (!(await this.allowed())) {
			return forbidden;
		}
		const change = GradeChange.from(request);
		if (!change.ok) {
			return change;
		}
		const id = await this.repository.saveGrade(change.value);
		const shown = request.shown;
		const label = `等級「${change.value.name}」`;
		output.present({
			id,
			message: !shown
				? `${label}を追加しました。`
				: shown.itemSetId !== change.value.itemSetId && shown.sheetCount > 0
					? `${label}を保存しました。この等級で作成済みの評価シート ${shown.sheetCount} 枚は、作成時の共通目標のままです。`
					: `${label}を保存しました。`,
		});
		return ok(undefined);
	}
}

export class DeleteEmployeeGradeInteractor
	extends GradeMasterUseCase
	implements
		FallibleUseCase<{ grade: GradeEntry }, OutputPort<{ message: string }>, GradeMasterError>
{
	async execute(
		request: { grade: GradeEntry },
		output: OutputPort<{ message: string }>,
	): Promise<Result<void, GradeMasterError>> {
		if (!(await this.allowed())) {
			return forbidden;
		}
		const deletable = canDeleteGrade(request.grade);
		if (!deletable.ok) {
			return deletable;
		}
		await this.repository.deleteGrade(request.grade);
		output.present({ message: `等級「${request.grade.name}」を削除しました。` });
		return ok(undefined);
	}
}

export interface SaveCommonGoalSetRequest {
	name: string;
	items: readonly CommonGoalDraft[];
	/** 変更するときは画面に出していたセット。追加は null。 */
	shown: CommonGoalSet | null;
}

/**
 * 共通目標セットの追加・変更。作成済みのシートが使うセットの項目を変えると、DB が新版を作って
 * 等級を付け替える(作成済みのシートは前の版のまま)。
 */
export class SaveCommonGoalSetInteractor
	extends GradeMasterUseCase
	implements FallibleUseCase<SaveCommonGoalSetRequest, OutputPort<SavedResponse>, GradeMasterError>
{
	async execute(
		request: SaveCommonGoalSetRequest,
		output: OutputPort<SavedResponse>,
	): Promise<Result<void, GradeMasterError>> {
		if (!(await this.allowed())) {
			return forbidden;
		}
		const change = CommonGoalSetChange.from(request);
		if (!change.ok) {
			return change;
		}
		const id = await this.repository.saveCommonGoalSet(change.value);
		const shown = request.shown;
		const label = `共通目標「${change.value.name}」`;
		output.present({
			id,
			message: !shown
				? `${label}を追加しました。`
				: id !== shown.id
					? `${label}を新しい版として保存しました。作成済みの評価シート ${shown.sheetCount} 枚は前の版のままです。これから作るシートから新しい版になります。`
					: `${label}を保存しました。`,
		});
		return ok(undefined);
	}
}

export class DeleteCommonGoalSetInteractor
	extends GradeMasterUseCase
	implements
		FallibleUseCase<
			{ set: CommonGoalSet; grades: readonly GradeEntry[] },
			OutputPort<{ message: string }>,
			GradeMasterError
		>
{
	async execute(
		request: { set: CommonGoalSet; grades: readonly GradeEntry[] },
		output: OutputPort<{ message: string }>,
	): Promise<Result<void, GradeMasterError>> {
		if (!(await this.allowed())) {
			return forbidden;
		}
		const deletable = canDeleteCommonGoalSet(request.set, request.grades);
		if (!deletable.ok) {
			return deletable;
		}
		await this.repository.deleteCommonGoalSet(request.set);
		output.present({ message: `共通目標「${request.set.name}」を削除しました。` });
		return ok(undefined);
	}
}
