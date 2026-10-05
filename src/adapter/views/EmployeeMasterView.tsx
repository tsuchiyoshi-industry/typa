import { ClipboardList, Save, ShieldCheck, User, UserCheck, Users } from "lucide-solid";
import {
	type Component,
	createEffect,
	createMemo,
	createSignal,
	For,
	on,
	onMount,
	Show,
} from "solid-js";
import type { EvaluatorType } from "../../domain/repositories/EmployeeMasterRepository";
import type { EmployeeMasterController } from "../controllers/EmployeeMasterController";
import type { EmployeeMasterViewModel } from "../presenters/EmployeeMasterPresenter";
import { showToast } from "./feedback";

interface EmployeeMasterViewProps {
	controller: EmployeeMasterController;
	viewModel: () => EmployeeMasterViewModel;
}

const EmployeeMasterView: Component<EmployeeMasterViewProps> = (props) => {
	const [primaryEmployeeNo, setPrimaryEmployeeNo] = createSignal("");
	const [secondaryEmployeeNo, setSecondaryEmployeeNo] = createSignal("");
	const [relationFilter, setRelationFilter] = createSignal("");
	const [assigningType, setAssigningType] = createSignal<EvaluatorType | null>(null);

	onMount(() => {
		void props.controller.load();
	});

	// 設定・更新の結果はトーストで知らせる
	createEffect(
		on(
			() => props.viewModel().assignmentStatus,
			(status) => {
				if (status.message) {
					showToast(status.success ? "success" : "error", status.message);
				}
			},
			{ defer: true },
		),
	);

	const filteredRelations = createMemo(() => {
		const keyword = relationFilter().trim().toLowerCase();
		if (!keyword) {
			return props.viewModel().relations;
		}

		return props
			.viewModel()
			.relations.filter(
				(relation) =>
					relation.employeeNo.toLowerCase().includes(keyword) ||
					relation.name.toLowerCase().includes(keyword),
			);
	});

	const handleAssign = async (evaluatorType: EvaluatorType) => {
		const employeeNo =
			evaluatorType === "primary" ? primaryEmployeeNo().trim() : secondaryEmployeeNo().trim();
		if (!employeeNo) {
			return;
		}
		setAssigningType(evaluatorType);
		await props.controller.assignEvaluator(employeeNo, evaluatorType);
		setAssigningType(null);
		if (props.viewModel().assignmentStatus.success) {
			if (evaluatorType === "primary") {
				setPrimaryEmployeeNo("");
			} else {
				setSecondaryEmployeeNo("");
			}
		}
	};

	const AdminEvaluatorControl: Component<{
		targetEmployeeNo: string;
		currentEvaluatorName: string;
		evaluatorType: EvaluatorType;
	}> = (controlProps) => {
		const [evaluatorEmployeeNo, setEvaluatorEmployeeNo] = createSignal("");
		const [updating, setUpdating] = createSignal(false);
		const label = () => (controlProps.evaluatorType === "primary" ? "一次評価者" : "二次評価者");
		// 入力した社員番号が誰なのかを、保存前に確認できるようにする
		const matchedName = () =>
			props.viewModel().relations.find((item) => item.employeeNo === evaluatorEmployeeNo().trim())
				?.name;

		const handleUpdate = async () => {
			const employeeNo = evaluatorEmployeeNo().trim();
			if (!employeeNo) {
				return;
			}
			setUpdating(true);
			await props.controller.updateEvaluator(
				controlProps.targetEmployeeNo,
				employeeNo,
				controlProps.evaluatorType,
			);
			setUpdating(false);
			if (props.viewModel().assignmentStatus.success) {
				setEvaluatorEmployeeNo("");
			}
		};

		return (
			<form
				class="admin-evaluator-form"
				onSubmit={(event) => {
					event.preventDefault();
					void handleUpdate();
				}}
			>
				<span>{controlProps.currentEvaluatorName}</span>
				<div class="admin-evaluator-row">
					<input
						type="text"
						value={evaluatorEmployeeNo()}
						onInput={(event) => setEvaluatorEmployeeNo(event.currentTarget.value)}
						placeholder={`${label()}の社員番号`}
						aria-label={`${controlProps.targetEmployeeNo} の ${label()} 社員番号`}
						list="employee-options"
						autocomplete="off"
					/>
					<button
						type="submit"
						class="icon-action"
						aria-label={`${label()}を更新`}
						title={`${label()}を更新`}
						disabled={updating() || !evaluatorEmployeeNo().trim()}
					>
						<Save class="action-icon" />
					</button>
				</div>
				<Show when={evaluatorEmployeeNo().trim()}>
					<span class="field-hint" classList={{ invalid: !matchedName() }}>
						{matchedName() ? `→ ${matchedName()} に変更` : "該当する社員が見つかりません"}
					</span>
				</Show>
			</form>
		);
	};

	const ProfilePanel = () => (
		<section class="master-profile-panel">
			<div class="master-section-title">
				<User class="master-section-icon" />
				<div>
					<h2>プロフィール</h2>
					<p>{props.viewModel().currentEmployee?.roleName ?? "Employee"}</p>
				</div>
			</div>
			<div class="master-profile-grid">
				<div class="master-profile-item">
					<span>氏名</span>
					<strong>{props.viewModel().currentEmployee?.name ?? "未設定"}</strong>
				</div>
				<div class="master-profile-item">
					<span>社員番号</span>
					<strong>{props.viewModel().currentEmployee?.employeeNo ?? "未設定"}</strong>
				</div>
				<div class="master-profile-item">
					<span>等級</span>
					<strong>{props.viewModel().currentEmployee?.gradeName ?? "未設定"}</strong>
				</div>
				<div class="master-profile-item">
					<span>キャリアコース</span>
					<strong>{props.viewModel().currentEmployee?.careerCourse ?? "未設定"}</strong>
				</div>
				<div class="master-profile-item">
					<span>一次評価者</span>
					<strong>{props.viewModel().currentEmployee?.primaryEvaluatorName ?? "未設定"}</strong>
				</div>
				<div class="master-profile-item">
					<span>二次評価者</span>
					<strong>{props.viewModel().currentEmployee?.secondaryEvaluatorName ?? "未設定"}</strong>
				</div>
			</div>
		</section>
	);

	const AssignmentPanel = () => (
		<section class="master-assignment-panel">
			<div class="master-section-title">
				<UserCheck class="master-section-icon" />
				<div>
					<h2>部下設定</h2>
					<p>評価者種別ごとに対象社員番号を入力</p>
				</div>
			</div>
			<div class="assignment-grid">
				<form
					class="assignment-form"
					onSubmit={(event) => {
						event.preventDefault();
						void handleAssign("primary");
					}}
				>
					<label for="primary-employee-no">一次評価者として担当する社員番号</label>
					<div class="assignment-input-row">
						<input
							id="primary-employee-no"
							type="text"
							value={primaryEmployeeNo()}
							onInput={(event) => setPrimaryEmployeeNo(event.currentTarget.value)}
							placeholder="例: 10023"
						/>
						<button
							type="submit"
							class="primary-action"
							disabled={assigningType() !== null || !primaryEmployeeNo().trim()}
						>
							<Save class="action-icon" />
							<span>{assigningType() === "primary" ? "設定中..." : "設定"}</span>
						</button>
					</div>
				</form>
				<form
					class="assignment-form"
					onSubmit={(event) => {
						event.preventDefault();
						void handleAssign("secondary");
					}}
				>
					<label for="secondary-employee-no">二次評価者として担当する社員番号</label>
					<div class="assignment-input-row">
						<input
							id="secondary-employee-no"
							type="text"
							value={secondaryEmployeeNo()}
							onInput={(event) => setSecondaryEmployeeNo(event.currentTarget.value)}
							placeholder="例: 10023"
						/>
						<button
							type="submit"
							class="primary-action"
							disabled={assigningType() !== null || !secondaryEmployeeNo().trim()}
						>
							<Save class="action-icon" />
							<span>{assigningType() === "secondary" ? "設定中..." : "設定"}</span>
						</button>
					</div>
				</form>
			</div>
		</section>
	);

	const RelationsTable = () => (
		<section class="master-relations-panel">
			<div class="master-section-title master-relations-title">
				<div class="master-section-heading">
					<ClipboardList class="master-section-icon" />
					<div>
						<h2>{props.viewModel().canViewAllRelations ? "承認先関係一覧" : "担当中の部下"}</h2>
						<p>
							{props.viewModel().canViewAllRelations
								? "全社員の一次・二次評価者"
								: "自分が評価者に設定されている社員"}
						</p>
					</div>
				</div>
				<label class="master-filter-field" for="relation-filter">
					<span>検索</span>
					<input
						id="relation-filter"
						type="search"
						value={relationFilter()}
						onInput={(event) => setRelationFilter(event.currentTarget.value)}
						placeholder="社員番号・氏名"
					/>
				</label>
			</div>
			<Show when={props.viewModel().canViewAllRelations}>
				<datalist id="employee-options">
					<For each={props.viewModel().relations}>
						{(relation) => <option value={relation.employeeNo}>{relation.name}</option>}
					</For>
				</datalist>
			</Show>
			<Show
				when={filteredRelations().length > 0}
				fallback={
					<p>
						{relationFilter().trim()
							? `「${relationFilter().trim()}」に一致する社員はいません。`
							: "表示できる社員はいません。"}
					</p>
				}
			>
				<div class="table-scroll">
					<table class="master-table">
						<thead>
							<tr>
								<th>社員番号</th>
								<th>氏名</th>
								<th>等級</th>
								<th>一次評価者</th>
								<th>二次評価者</th>
							</tr>
						</thead>
						<tbody>
							<For each={filteredRelations()}>
								{(relation) => (
									<tr>
										<td>{relation.employeeNo}</td>
										<td>{relation.name}</td>
										<td>{relation.gradeName}</td>
										<td>
											<Show
												when={props.viewModel().canViewAllRelations}
												fallback={relation.primaryEvaluatorName}
											>
												<AdminEvaluatorControl
													targetEmployeeNo={relation.employeeNo}
													currentEvaluatorName={relation.primaryEvaluatorName}
													evaluatorType="primary"
												/>
											</Show>
										</td>
										<td>
											<Show
												when={props.viewModel().canViewAllRelations}
												fallback={relation.secondaryEvaluatorName}
											>
												<AdminEvaluatorControl
													targetEmployeeNo={relation.employeeNo}
													currentEvaluatorName={relation.secondaryEvaluatorName}
													evaluatorType="secondary"
												/>
											</Show>
										</td>
									</tr>
								)}
							</For>
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
					<p>社員プロフィールと承認先関係を確認します。</p>
				</div>
				<div class="master-role-badge">
					<ShieldCheck class="master-role-icon" />
					<span>{props.viewModel().currentEmployee?.roleName ?? "Employee"}</span>
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
				when={!props.viewModel().loading || props.viewModel().currentEmployee}
				fallback={<p class="page-note">社員マスタを読み込んでいます...</p>}
			>
				<ProfilePanel />
				<Show when={props.viewModel().canAssignEvaluators}>
					<AssignmentPanel />
				</Show>
				<Show when={props.viewModel().mode !== "employee"}>
					<RelationsTable />
				</Show>
			</Show>
		</div>
	);
};

export default EmployeeMasterView;
