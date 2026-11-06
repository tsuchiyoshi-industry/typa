import { messageOf } from "../../application/errorMessage";
import {
	type DeleteCommonGoalSetInteractor,
	type DeleteEmployeeGradeInteractor,
	describeGradeMasterError,
	type LoadGradeMasterInteractor,
	type SaveCommonGoalSetInteractor,
	type SaveCommonGoalSetRequest,
	type SaveEmployeeGradeInteractor,
	type SaveEmployeeGradeRequest,
} from "../../application/usecases/GradeMasterInteractors";
import {
	type CommonGoalSet,
	CommonGoalSetChange,
	type GradeEntry,
	type GradeMaster,
	type GradeMasterError,
} from "../../domain/entities/GradeMaster";
import type { Result } from "../../domain/Result";

export type GradeMasterResult =
	| { success: true; message: string; id?: number }
	| { success: false; message: string };

/** 等級と共通目標のマスタの画面(Admin だけ)。等級の画面と共通目標の画面で共有する。 */
export class GradeMasterController {
	constructor(
		private readonly loadUseCase: LoadGradeMasterInteractor,
		private readonly saveGradeUseCase: SaveEmployeeGradeInteractor,
		private readonly deleteGradeUseCase: DeleteEmployeeGradeInteractor,
		private readonly saveSetUseCase: SaveCommonGoalSetInteractor,
		private readonly deleteSetUseCase: DeleteCommonGoalSetInteractor,
	) {}

	/** Admin でなければ何も読まずに断る(URL を直接開いたときも)。 */
	async load(): Promise<GradeMaster> {
		let master: GradeMaster | null = null;
		const result = await this.loadUseCase.execute(undefined, {
			present: (value) => {
				master = value;
			},
		});
		if (!result.ok || !master) {
			throw new Error(
				result.ok
					? "等級と共通目標を読み込めませんでした。"
					: describeGradeMasterError(result.error),
			);
		}
		return master;
	}

	saveGrade(request: SaveEmployeeGradeRequest): Promise<GradeMasterResult> {
		return run("等級を保存できませんでした。", (present) =>
			this.saveGradeUseCase.execute(request, { present }),
		);
	}

	deleteGrade(grade: GradeEntry): Promise<GradeMasterResult> {
		return run("等級を削除できませんでした。", (present) =>
			this.deleteGradeUseCase.execute({ grade }, { present }),
		);
	}

	saveCommonGoalSet(request: SaveCommonGoalSetRequest): Promise<GradeMasterResult> {
		return run("共通目標を保存できませんでした。", (present) =>
			this.saveSetUseCase.execute(request, { present }),
		);
	}

	deleteCommonGoalSet(
		set: CommonGoalSet,
		grades: readonly GradeEntry[],
	): Promise<GradeMasterResult> {
		return run("共通目標を削除できませんでした。", (present) =>
			this.deleteSetUseCase.execute({ set, grades }, { present }),
		);
	}

	/** 保存すると新版になるか(作成済みのシートが使うセットの項目を変える)。確認の文言を変えるために使う。 */
	makesNewVersion(request: SaveCommonGoalSetRequest): boolean {
		const change = CommonGoalSetChange.from(request);
		return change.ok && change.value.makesNewVersion();
	}
}

async function run(
	fallback: string,
	execute: (
		present: (response: { message: string; id?: number }) => void,
	) => Promise<Result<void, GradeMasterError>>,
): Promise<GradeMasterResult> {
	let response: { message: string; id?: number } = { message: "" };
	try {
		const result = await execute((value) => {
			response = value;
		});
		return result.ok
			? { success: true, ...response }
			: { success: false, message: describeGradeMasterError(result.error) };
	} catch (error) {
		return { success: false, message: messageOf(error, fallback) };
	}
}
