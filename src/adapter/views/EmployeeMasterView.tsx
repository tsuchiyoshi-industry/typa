import { Search, ShieldCheck, Users } from "lucide-solid";
import {
	type Component,
	createEffect,
	createMemo,
	createSignal,
	For,
	Index,
	on,
	onMount,
	type ParentComponent,
	Show,
} from "solid-js";
import type { ApprovalRelationDto } from "../../application/dtos/EmployeeMasterDto";
import type { EvaluatorType } from "../../domain/repositories/EmployeeMasterRepository";
import type { EmployeeMasterController } from "../controllers/EmployeeMasterController";
import type { EmployeeMasterViewModel } from "../presenters/EmployeeMasterPresenter";
import { confirmAction, showToast } from "./feedback";

interface EmployeeMasterViewProps {
	controller: EmployeeMasterController;
	viewModel: () => EmployeeMasterViewModel;
}

type Scope = "all" | "mine" | "unset";

/** 二次評価者「なし」を表す選択肢の値。未設定(空文字)と区別する。 */
const NO_SECONDARY = "__none__";

const EmployeeMasterView: Component<EmployeeMasterViewProps> = (props) => {
	const [keyword, setKeyword] = createSignal("");
	const [scope, setScope] = createSignal<Scope>("all");
	const [savingKey, setSavingKey] = createSignal<string | null>(null);

	onMount(() => {
		void props.controller.load();
	});

	// 更新の結果はトーストで知らせる
	createEffect(
		on(
			() => props.viewModel().updateStatus,
			(status) => {
				if (status.message) {
					showToast(status.success ? "success" : "error", status.message);
				}
			},
			{ defer: true },
		),
	);

	const me = () => props.viewModel().currentEmployee;
	// 読み込み中フラグなど無関係な更新で一覧を描き直さないよう、配列単位で購読する
	const relations = createMemo(() => props.viewModel().relations);
	const grades = createMemo(() => props.viewModel().grades);

	const isMine = (relation: ApprovalRelationDto) =>
		relation.primaryEvaluatorId === me()?.id || relation.secondaryEvaluatorId === me()?.id;
	// 二次評価者は「なし」と明示されていれば設定済み。自分で埋められない項目(Reviewer にとっての等級)は数えない
	const hasUnset = (relation: ApprovalRelationDto) =>
		relation.primaryEvaluatorId == null ||
		(relation.secondaryEvaluatorId == null && !relation.noSecondaryEvaluator) ||
		(props.viewModel().canEditGrades && relation.gradeId == null);

	const scopes = createMemo<{ value: Scope; label: string; count: number }[]>(() => [
		{ value: "all", label: "全員", count: relations().length },
		{ value: "mine", label: "自分の担当", count: relations().filter(isMine).length },
		{ value: "unset", label: "未設定あり", count: relations().filter(hasUnset).length },
	]);

	const visibleRelations = createMemo(() => {
		const text = keyword().trim().toLowerCase();
		return relations().filter(
			(relation) =>
				(scope() === "all" || (scope() === "mine" ? isMine(relation) : hasUnset(relation))) &&
				(!text ||
					relation.employeeNo.toLowerCase().includes(text) ||
					relation.name.toLowerCase().includes(text)),
		);
	});

	const employeeNoById = createMemo(
		() => new Map(relations().map((relation) => [relation.employeeId, relation.employeeNo])),
	);

	const emptyMessage = () => {
		if (keyword().trim()) {
			return `「${keyword().trim()}」に一致する社員はいません。`;
		}
		if (scope() === "mine") {
			return "あなたが評価者になっている社員はまだいません。「全員」の一覧で評価者に自分を選ぶと、ここに並びます。";
		}
		return scope() === "unset" ? "未設定の項目はありません。" : "表示できる社員はいません。";
	};

	// 選ぶとその場で保存する。保存できなかったときは元の選択に戻す。
	const CellSelect: ParentComponent<{
		label: string;
		value: string;
		saveKey: string;
		onPick: (value: string) => Promise<boolean>;
	}> = (cell) => {
		let select!: HTMLSelectElement;
		// option を差し替えると選択が先頭に戻るため、描画の更新が済んでから合わせ直す
		createEffect(() => {
			relations();
			grades();
			select.value = cell.value;
		});

		const handleChange = async () => {
			const previous = cell.value;
			setSavingKey(cell.saveKey);
			const saved = await cell.onPick(select.value);
			setSavingKey(null);
			if (!saved) {
				select.value = previous;
			}
			select.focus();
		};

		return (
			<span
				class="cell-select"
				classList={{ unset: !cell.value, saving: savingKey() === cell.saveKey }}
			>
				<select
					ref={select}
					aria-label={cell.label}
					disabled={savingKey() !== null}
					onChange={() => void handleChange()}
				>
					<option value="" disabled>
						未設定
					</option>
					{cell.children}
				</select>
			</span>
		);
	};

	const EvaluatorCell: Component<{
		relation: ApprovalRelationDto;
		evaluatorType: EvaluatorType;
	}> = (cell) => {
		const label = () => (cell.evaluatorType === "primary" ? "一次評価者" : "二次評価者");
		const evaluatorId = () =>
			cell.evaluatorType === "primary"
				? cell.relation.primaryEvaluatorId
				: cell.relation.secondaryEvaluatorId;

		// 二次評価者は「未設定(指定待ち)」と「なし(明示)」を別の値として扱う
		const selected = () =>
			cell.evaluatorType === "secondary" &&
			evaluatorId() == null &&
			cell.relation.noSecondaryEvaluator
				? NO_SECONDARY
				: (employeeNoById().get(evaluatorId() ?? -1) ?? "");

		const pick = async (value: string) => {
			if (value !== NO_SECONDARY) {
				return props.controller.updateEvaluator(
					cell.relation.employeeNo,
					value,
					cell.evaluatorType,
				);
			}
			const confirmed = await confirmAction({
				title: `${cell.relation.name}さんの二次評価者を「なし」にしますか？`,
				message:
					"一次評価者の評価がそのまま最終評価になり、一次評価者が最終評価ランクの決定と評価の確定を行います。",
				confirmLabel: "「なし」にする",
			});
			return (
				confirmed && props.controller.updateEvaluator(cell.relation.employeeNo, null, "secondary")
			);
		};

		return (
			<CellSelect
				label={`${cell.relation.name}さんの${label()}`}
				value={selected()}
				saveKey={`${cell.relation.employeeNo}:${cell.evaluatorType}`}
				onPick={pick}
			>
				<Show when={cell.evaluatorType === "secondary"}>
					<option value={NO_SECONDARY}>なし（一次評価が最終評価）</option>
				</Show>
				{/* ponytail: 全行×全社員ぶんの option を描画する(O(N²))。数百名を超えて重くなったら、操作中の行だけ select を描く */}
				<For each={relations()}>
					{(candidate) => (
						<option
							value={candidate.employeeNo}
							disabled={candidate.employeeId === cell.relation.employeeId}
						>
							{`${candidate.name}（${candidate.employeeNo}）`}
						</option>
					)}
				</For>
			</CellSelect>
		);
	};

	const GradeCell: Component<{ relation: ApprovalRelationDto }> = (cell) => {
		const changeGrade = async (gradeId: string) => {
			const grade = grades().find((item) => String(item.id) === gradeId);
			if (!grade) {
				return false;
			}
			const confirmed = await confirmAction({
				title: `${cell.relation.name}さんの等級を「${grade.name}」に変更しますか？`,
				message:
					"共通評価の項目は等級ごとに決まります。進行中の評価シートがある場合、その項目も新しい等級のものに切り替わります。",
				confirmLabel: "等級を変更する",
			});
			return confirmed && props.controller.updateGrade(cell.relation.employeeNo, grade.id);
		};

		return (
			<CellSelect
				label={`${cell.relation.name}さんの等級`}
				value={cell.relation.gradeId == null ? "" : String(cell.relation.gradeId)}
				saveKey={`${cell.relation.employeeNo}:grade`}
				onPick={changeGrade}
			>
				<For each={grades()}>
					{(grade) => <option value={String(grade.id)}>{grade.name}</option>}
				</For>
			</CellSelect>
		);
	};

	const ProfilePanel = () => (
		<section class="master-profile" aria-label="あなたのプロフィール">
			<div class="master-profile-id">
				<strong>{me()?.name ?? "未設定"}</strong>
				<span class="employee-no">{me()?.employeeNo ?? "社員番号 未設定"}</span>
			</div>
			<dl class="master-profile-facts">
				<For
					each={[
						["等級", me()?.gradeName],
						["キャリアコース", me()?.careerCourse],
						["一次評価者", me()?.primaryEvaluatorName],
						["二次評価者", me()?.secondaryEvaluatorName],
					]}
				>
					{([label, value]) => (
						<div>
							<dt>{label}</dt>
							<dd classList={{ unset: !value || value === "未設定" }}>{value ?? "未設定"}</dd>
						</div>
					)}
				</For>
			</dl>
		</section>
	);

	const EmployeeList = () => (
		<section class="master-list">
			<div class="master-list-head">
				<div>
					<h2>社員一覧</h2>
					<p>
						{props.viewModel().canEditGrades ? "等級と評価者" : "評価者"}
						は、一覧から選ぶとその場で保存されます。二次評価者を「なし」にした社員は一次評価がそのまま最終評価になり、「未設定」のままの社員は評価を確定できません。
					</p>
				</div>
				<label class="master-search">
					<Search class="master-search-icon" />
					<input
						type="search"
						value={keyword()}
						onInput={(event) => setKeyword(event.currentTarget.value)}
						placeholder="氏名・社員番号で検索"
						aria-label="氏名・社員番号で検索"
					/>
				</label>
			</div>
			<fieldset class="master-scope">
				<legend class="visually-hidden">表示する社員</legend>
				<For each={scopes()}>
					{(item) => (
						<button
							type="button"
							aria-pressed={scope() === item.value}
							onClick={() => setScope(item.value)}
						>
							{item.label}
							<span>{item.count}</span>
						</button>
					)}
				</For>
			</fieldset>
			<Show
				when={visibleRelations().length > 0}
				fallback={<p class="master-empty">{emptyMessage()}</p>}
			>
				<div class="table-scroll">
					<table class="master-table">
						<thead>
							<tr>
								<th scope="col">社員</th>
								<th scope="col">等級</th>
								<th scope="col">一次評価者</th>
								<th scope="col">二次評価者</th>
							</tr>
						</thead>
						<tbody>
							<Index each={visibleRelations()}>
								{(relation) => (
									<tr>
										<th scope="row">
											<span class="employee-name">{relation().name}</span>
											<span class="employee-no">{relation().employeeNo}</span>
										</th>
										<td>
											<Show
												when={props.viewModel().canEditGrades}
												fallback={
													<span class="cell-text" classList={{ unset: relation().gradeId == null }}>
														{relation().gradeName}
													</span>
												}
											>
												<GradeCell relation={relation()} />
											</Show>
										</td>
										<td>
											<EvaluatorCell relation={relation()} evaluatorType="primary" />
										</td>
										<td>
											<EvaluatorCell relation={relation()} evaluatorType="secondary" />
										</td>
									</tr>
								)}
							</Index>
						</tbody>
					</table>
				</div>
			</Show>
		</section>
	);

	return (
		<div class="employee-master-page">
			<header class="master-header">
				<div>
					<h1>
						<Users class="header-icon" />
						社員マスタ
					</h1>
					<p>
						{props.viewModel().canEditEvaluators
							? "社員ごとの等級と評価者を管理します。"
							: "あなたの等級と評価者を確認できます。"}
					</p>
				</div>
				<div class="master-role-badge">
					<ShieldCheck class="master-role-icon" />
					<span>{me()?.roleName ?? "Employee"}</span>
				</div>
			</header>

			<Show when={props.viewModel().errorMessage}>
				<div class="inline-alert" role="alert">
					<span>{props.viewModel().errorMessage}</span>
					<button type="button" class="secondary-action" onClick={() => props.controller.load()}>
						再読み込み
					</button>
				</div>
			</Show>

			<Show
				when={!props.viewModel().loading || me()}
				fallback={<p class="page-note">社員マスタを読み込んでいます...</p>}
			>
				<ProfilePanel />
				<Show when={props.viewModel().canEditEvaluators}>
					<EmployeeList />
				</Show>
			</Show>
		</div>
	);
};

export default EmployeeMasterView;
