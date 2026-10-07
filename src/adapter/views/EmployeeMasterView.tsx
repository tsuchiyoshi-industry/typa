import { List, Network, Search, Trash2, Users } from "lucide-solid";
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
import {
	EMPLOYEE_ROLE_NAMES,
	EmployeeRole,
	type EmployeeRoleName,
} from "../../domain/valueObjects/EmployeeRole";
import type { EmployeeMasterController } from "../controllers/EmployeeMasterController";
import type { EmployeeMasterViewModel } from "../presenters/EmployeeMasterPresenter";
import EvaluationStructure from "./components/EvaluationStructure";
import SearchableEvaluatorSelect from "./components/SearchableEvaluatorSelect";
import { confirmAction, showToast } from "./feedback";

interface EmployeeMasterViewProps {
	controller: EmployeeMasterController;
	viewModel: () => EmployeeMasterViewModel;
}

type Scope = "all" | "mine" | "unset";
/** list: 設定を変える一覧(既定) / structure: 評価の流れを見る図 */
type ListView = "list" | "structure";

const ROLE_DESCRIPTIONS: Record<EmployeeRoleName, string> = {
	Admin: "社員マスタで全員の権限・等級・評価者を変更でき、登録の取り消しもできます。",
	Reviewer: "社員マスタで全員の評価者を変更でき、評価構造を確認できます。",
	Employee: "社員マスタでは自分の情報だけを閲覧できます。",
};

/** 二次評価者「なし」を表す選択肢の値。未設定(空文字)と区別する。 */
const NO_SECONDARY = "__none__";

const EmployeeMasterView: Component<EmployeeMasterViewProps> = (props) => {
	const [keyword, setKeyword] = createSignal("");
	const [scope, setScope] = createSignal<Scope>("all");
	const [listView, setListView] = createSignal<ListView>("list");
	const [savingKey, setSavingKey] = createSignal<string | null>(null);

	onMount(() => {
		void props.controller.load();
	});

	// 更新の結果はトーストで知らせる。更新後の再読み込みなど無関係な変化で同じ結果を
	// 出し直さないよう、結果そのものが入れ替わったときだけ反応させる
	const updateStatus = createMemo(() => props.viewModel().updateStatus);
	createEffect(
		on(
			updateStatus,
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
	// 役員の等級・評価者は管理しない。権限だけは変えられるので、Admin の一覧には役員も出す
	const isExecutive = (relation: ApprovalRelationDto) => relation.careerCourse?.trim() === "役員";
	const managedRelations = createMemo(() =>
		relations().filter((relation) => props.viewModel().canEditRoles || !isExecutive(relation)),
	);

	const isMine = (relation: ApprovalRelationDto) =>
		relation.primaryEvaluatorId === me()?.id || relation.secondaryEvaluatorId === me()?.id;
	// 二次評価者は「なし」と明示されていれば設定済み。自分で埋められない項目(Reviewer にとっての等級)は数えない
	const hasUnset = (relation: ApprovalRelationDto) =>
		!isExecutive(relation) &&
		(relation.primaryEvaluatorId == null ||
			(relation.secondaryEvaluatorId == null && !relation.noSecondaryEvaluator) ||
			(props.viewModel().canEditGrades && relation.gradeId == null));

	const scopes = createMemo<{ value: Scope; label: string; count: number }[]>(() => [
		{ value: "all", label: "全員", count: managedRelations().length },
		{ value: "mine", label: "自分の担当", count: managedRelations().filter(isMine).length },
		{ value: "unset", label: "未設定あり", count: managedRelations().filter(hasUnset).length },
	]);

	const visibleRelations = createMemo(() => {
		const text = keyword().trim().toLowerCase();
		return managedRelations().filter(
			(relation) =>
				(scope() === "all" || (scope() === "mine" ? isMine(relation) : hasUnset(relation))) &&
				(!text ||
					relation.employeeNo.toLowerCase().includes(text) ||
					relation.name.toLowerCase().includes(text)),
		);
	});

	// 評価の流れに出すのは評価される社員。役員は評価する側としてだけ現れる
	const structureRelations = createMemo(() =>
		visibleRelations().filter((relation) => !isExecutive(relation)),
	);

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
		const [pending, setPending] = createSignal<string | null>(null);
		// Apply the authoritative value after Solid has replaced the option nodes.
		createEffect(() => {
			cell.value;
			grades();
			pending();
			queueMicrotask(() => {
				if (select.isConnected) {
					select.value = pending() ?? cell.value;
				}
			});
		});

		const handleChange = async () => {
			const picked = select.value;
			if (picked === cell.value) {
				return;
			}
			setPending(picked);
			setSavingKey(cell.saveKey);
			try {
				await cell.onPick(picked);
			} finally {
				setPending(null);
				setSavingKey(null);
				if (select.isConnected) {
					select.focus();
				}
			}
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

		const options = createMemo(() => [
			...(cell.evaluatorType === "secondary"
				? [{ value: NO_SECONDARY, name: "なし（一次評価が最終評価）" }]
				: []),
			...relations()
				.filter((candidate) => candidate.employeeId !== cell.relation.employeeId)
				.map((candidate) => ({
					value: candidate.employeeNo,
					name: candidate.name,
					employeeNo: candidate.employeeNo,
				})),
		]);
		const saveKey = () => `${cell.relation.employeeNo}:${cell.evaluatorType}`;
		return (
			<SearchableEvaluatorSelect
				label={`${cell.relation.name}さんの${label()}`}
				value={selected()}
				options={options()}
				disabled={savingKey() !== null}
				saving={savingKey() === saveKey()}
				onPick={async (value) => {
					setSavingKey(saveKey());
					try {
						return await pick(value);
					} finally {
						setSavingKey(null);
					}
				}}
			/>
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

	const RoleCell: Component<{ relation: ApprovalRelationDto }> = (cell) => {
		const changeRole = async (picked: string) => {
			const role = EmployeeRole.find(picked);
			if (!role) {
				return false;
			}
			const self = cell.relation.employeeId === me()?.id;
			const confirmed = await confirmAction({
				title: `${cell.relation.name}さんの権限を ${role} に変更しますか？`,
				message: `${role}: ${ROLE_DESCRIPTIONS[role.toString()]}${
					self && !role.isAdmin()
						? " 自分の権限を変更すると、この画面で権限を管理できなくなります。"
						: ""
				}`,
				confirmLabel: "権限を変更する",
				tone: role.isAdmin() || self ? "danger" : "default",
			});
			const changed =
				confirmed && (await props.controller.updateRole(cell.relation.employeeNo, role.toString()));
			if (changed && self) {
				// 自分の権限が変わると、メニューや表示できる画面も変わる
				window.location.reload();
			}
			return changed;
		};

		return (
			<CellSelect
				label={`${cell.relation.name}さんの権限`}
				value={cell.relation.roleName ?? ""}
				saveKey={`${cell.relation.employeeNo}:role`}
				onPick={changeRole}
			>
				<For each={EMPLOYEE_ROLE_NAMES}>{(name) => <option value={name}>{name}</option>}</For>
			</CellSelect>
		);
	};

	// 社員の行と評価データは残し、ログイン用アカウントだけを消して未登録に戻す
	const resetRegistration = async (relation: ApprovalRelationDto) => {
		const confirmed = await confirmAction({
			title: `${relation.name}さんの登録を取り消しますか？`,
			message:
				"ログイン用のアカウントを削除します。本人が新規登録をやり直すまで、この社員番号ではログインできなくなります。評価シートなどのデータは残ります。",
			confirmLabel: "登録を取り消す",
			tone: "danger",
		});
		if (!confirmed) {
			return;
		}
		setSavingKey(`${relation.employeeNo}:registration`);
		await props.controller.resetRegistration(relation.employeeNo);
		setSavingKey(null);
	};

	const RegistrationCell: Component<{ relation: ApprovalRelationDto }> = (cell) => (
		<Show when={cell.relation.registered} fallback={<span class="cell-text unset">未登録</span>}>
			{/* 自分の登録を消すと操作中のセッションごと使えなくなるため、自分の行には出さない */}
			<Show when={cell.relation.employeeId !== me()?.id}>
				<button
					type="button"
					class="row-action"
					aria-label={`${cell.relation.name}さんの登録を取り消す`}
					title="登録を取り消す"
					disabled={savingKey() !== null}
					onClick={() => void resetRegistration(cell.relation)}
				>
					<Trash2 size={15} />
					<span>取消</span>
				</button>
			</Show>
		</Show>
	);

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
						{props.viewModel().canEditRoles
							? "権限・等級・評価者"
							: props.viewModel().canEditGrades
								? "等級と評価者"
								: "評価者"}
						を変更できます。選択すると自動で保存されます。
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
			<div class="master-list-toolbar">
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
				<div class="master-list-toolbar__side">
					<span class="master-result-count">{visibleRelations().length}名を表示</span>
					<fieldset class="master-scope">
						<legend class="visually-hidden">表示の形式</legend>
						<button
							type="button"
							aria-pressed={listView() === "list"}
							onClick={() => setListView("list")}
						>
							<List size={15} />
							リスト
						</button>
						<button
							type="button"
							aria-pressed={listView() === "structure"}
							onClick={() => setListView("structure")}
						>
							<Network size={15} />
							評価構造
						</button>
					</fieldset>
				</div>
			</div>
			<p class="master-list-note">
				<Show
					when={listView() === "list"}
					fallback="左から、評価を確定する二次評価者、一次評価者、評価される社員の順です。社員名を押すと、リストでその社員の設定を開きます。役員は評価される側には含めていません。"
				>
					評価者は氏名・社員番号で検索できます。
					{props.viewModel().canEditRoles
						? "役員は権限だけ変更できます（等級・評価者は管理対象外です）。Admin が0人になる変更はできません。"
						: "役員は管理対象から除外しています。"}
				</Show>
			</p>
			<Show when={listView() === "structure"}>
				<Show
					when={structureRelations().length > 0}
					fallback={<p class="master-empty">{emptyMessage()}</p>}
				>
					<EvaluationStructure
						relations={structureRelations()}
						currentEmployeeId={me()?.id}
						onPick={(relation) => {
							// 図は閲覧用。設定を変えるときは、その社員に絞った一覧へ戻る
							setKeyword(relation.employeeNo);
							setScope("all");
							setListView("list");
						}}
					/>
				</Show>
			</Show>
			<Show
				when={listView() === "list" && visibleRelations().length > 0}
				fallback={
					<Show when={listView() === "list"}>
						<p class="master-empty">{emptyMessage()}</p>
					</Show>
				}
			>
				<div class="table-scroll">
					<table class="master-table">
						<thead>
							<tr>
								<th scope="col">社員</th>
								<Show when={props.viewModel().canEditRoles}>
									<th scope="col">権限</th>
								</Show>
								<th scope="col">等級</th>
								<th scope="col">一次評価者</th>
								<th scope="col">二次評価者</th>
								<Show when={props.viewModel().canResetRegistrations}>
									<th scope="col" class="col-action">
										登録
									</th>
								</Show>
							</tr>
						</thead>
						<tbody>
							<Index each={visibleRelations()}>
								{(relation) => (
									<tr>
										<th scope="row">
											<span class="employee-name">{relation().name}</span>
											<span class="employee-no">
												{relation().employeeNo}
												<Show when={relation().careerCourse}> · {relation().careerCourse}</Show>
											</span>
										</th>
										<Show when={props.viewModel().canEditRoles}>
											<td>
												<RoleCell relation={relation()} />
											</td>
										</Show>
										<Show
											when={!isExecutive(relation())}
											fallback={
												// 役員は権限だけを管理する
												<td
													class="cell-text unset"
													colSpan={props.viewModel().canResetRegistrations ? 4 : 3}
												>
													役員（等級・評価者は管理対象外）
												</td>
											}
										>
											<td>
												<Show
													when={props.viewModel().canEditGrades}
													fallback={
														<span
															class="cell-text"
															classList={{ unset: relation().gradeId == null }}
														>
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
											<Show when={props.viewModel().canResetRegistrations}>
												<td class="col-action">
													<RegistrationCell relation={relation()} />
												</td>
											</Show>
										</Show>
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
