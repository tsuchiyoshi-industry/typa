import { A } from "@solidjs/router";
import ArrowLeft from "lucide-solid/icons/arrow-left";
import UserPlus from "lucide-solid/icons/user-plus";
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
import { CAREER_COURSES } from "../../domain/entities/EmployeeProfile";
import type { EmployeeMasterController } from "../controllers/EmployeeMasterController";
import type { EmployeeMasterViewModel } from "../presenters/EmployeeMasterPresenter";
import SearchableEvaluatorSelect from "./components/SearchableEvaluatorSelect";
import { confirmAction, showToast } from "./feedback";

/** 二次評価者「なし」を表す選択肢の値。未設定(空文字)と区別する。 */
const NO_SECONDARY = "__none__";

const EMPTY = {
	employeeNo: "",
	name: "",
	careerCourse: "",
	gradeId: "",
	primary: "",
	secondary: "",
};

/** 導入処理の「初期ユーザ」。招待コードを渡す前に、社員を社員マスタへ仮登録する。 */
const EmployeePreRegistrationView: Component<{
	controller: EmployeeMasterController;
	viewModel: () => EmployeeMasterViewModel;
}> = (props) => {
	const [form, setForm] = createSignal({ ...EMPTY });
	const [busy, setBusy] = createSignal(false);
	const set = (field: keyof typeof EMPTY, value: string) => setForm({ ...form(), [field]: value });

	onMount(() => {
		void props.controller.load();
	});

	// 社員マスタの画面と同じく、結果が入れ替わったときだけトーストで知らせる
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

	const grades = createMemo(() => props.viewModel().grades);
	const evaluators = createMemo(() =>
		props.viewModel().relations.map((relation) => ({
			value: relation.employeeNo,
			name: relation.name,
			employeeNo: relation.employeeNo,
		})),
	);
	const unset = { value: "", name: "未設定" };
	// 役員は評価される側ではないので、評価者を決めない
	const isExecutive = () => form().careerCourse === "役員";

	const submit = async (event: SubmitEvent) => {
		event.preventDefault();
		const value = form();
		const grade = grades().find((item) => String(item.id) === value.gradeId);
		const nameOf = (employeeNo: string) =>
			evaluators().find((item) => item.value === employeeNo)?.name ?? "未設定";
		const confirmed = await confirmAction({
			title: `${value.name.trim()}さんを仮登録しますか？`,
			message: "社員番号と氏名は、登録した後に画面から変えられません。",
			details: [
				`社員番号 ${value.employeeNo.trim()}`,
				`キャリアコース ${value.careerCourse}・等級 ${grade?.name ?? ""}`,
				...(isExecutive()
					? []
					: [
							`一次評価者 ${nameOf(value.primary)}`,
							`二次評価者 ${value.secondary === NO_SECONDARY ? "なし" : nameOf(value.secondary)}`,
						]),
			],
			note: "権限は Employee で始まります。本人が新規登録するには、社員マスタで招待コードを発行して渡します。",
			confirmLabel: "仮登録する",
		});
		if (!confirmed) {
			return;
		}
		setBusy(true);
		try {
			const executive = isExecutive();
			const registered = await props.controller.preRegister({
				employeeNo: value.employeeNo,
				name: value.name,
				careerCourse: value.careerCourse,
				gradeId: Number(value.gradeId),
				primaryEvaluatorEmployeeNo: executive ? null : value.primary || null,
				secondaryEvaluatorEmployeeNo:
					executive || value.secondary === NO_SECONDARY ? null : value.secondary || null,
				noSecondaryEvaluator: !executive && value.secondary === NO_SECONDARY,
			});
			if (registered) {
				setForm({ ...EMPTY });
			}
		} finally {
			setBusy(false);
		}
	};

	return (
		<div class="settings-page">
			<header class="master-header">
				<div>
					<A href="/setup" class="back-link">
						<ArrowLeft size={16} aria-hidden="true" />
						導入処理
					</A>
					<h1>
						<UserPlus class="header-icon" />
						初期ユーザ
					</h1>
					<p>
						社員を社員マスタに仮登録します。仮登録した社員には、
						<A href="/employee-master">社員マスタ</A>
						で招待コードを発行して渡します。
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
				when={props.viewModel().mode === "admin" || props.viewModel().loading}
				fallback={<p class="page-note">導入処理は Admin のみ利用できます。</p>}
			>
				<section class="info-card" aria-labelledby="pre-registration-heading">
					<h2 id="pre-registration-heading">社員を仮登録する</h2>
					<p class="allocation-note">
						社員番号・氏名・キャリアコース・等級は必須です。評価者は社員マスタで後から決められます。
					</p>
					<form
						class="allocation-form period-form pre-registration-form"
						onSubmit={(event) => void submit(event)}
					>
						<label>
							社員番号
							<input
								type="text"
								required
								autocomplete="off"
								placeholder="半角英数字"
								value={form().employeeNo}
								disabled={busy()}
								onInput={(event) => set("employeeNo", event.currentTarget.value)}
							/>
						</label>
						<label>
							氏名
							<input
								type="text"
								required
								autocomplete="off"
								value={form().name}
								disabled={busy()}
								onInput={(event) => set("name", event.currentTarget.value)}
							/>
						</label>
						<label>
							キャリアコース
							<span class="cell-select" classList={{ unset: !form().careerCourse }}>
								<select
									required
									value={form().careerCourse}
									disabled={busy()}
									onChange={(event) => set("careerCourse", event.currentTarget.value)}
								>
									<option value="" disabled>
										選んでください
									</option>
									<For each={CAREER_COURSES}>
										{(course) => <option value={course}>{course}</option>}
									</For>
								</select>
							</span>
						</label>
						<label>
							等級
							<span class="cell-select" classList={{ unset: !form().gradeId }}>
								<select
									required
									value={form().gradeId}
									disabled={busy()}
									onChange={(event) => set("gradeId", event.currentTarget.value)}
								>
									<option value="" disabled>
										選んでください
									</option>
									<For each={grades()}>
										{(grade) => <option value={String(grade.id)}>{grade.name}</option>}
									</For>
								</select>
							</span>
						</label>
						<Show when={!isExecutive()}>
							<div class="pre-registration-field">
								<span>一次評価者(任意)</span>
								<SearchableEvaluatorSelect
									label="一次評価者"
									value={form().primary}
									options={[unset, ...evaluators()]}
									disabled={busy()}
									saving={false}
									onPick={async (picked) => {
										set("primary", picked);
										return true;
									}}
								/>
							</div>
							<div class="pre-registration-field">
								<span>二次評価者(任意)</span>
								<SearchableEvaluatorSelect
									label="二次評価者"
									value={form().secondary}
									options={[
										unset,
										{ value: NO_SECONDARY, name: "なし（一次評価が最終評価）" },
										...evaluators(),
									]}
									disabled={busy()}
									saving={false}
									onPick={async (picked) => {
										set("secondary", picked);
										return true;
									}}
								/>
							</div>
						</Show>
						<div class="settings-actions">
							<button
								type="submit"
								class="primary-action"
								disabled={busy() || props.viewModel().loading}
							>
								{busy() ? "登録しています..." : "仮登録する"}
							</button>
						</div>
					</form>
				</section>
			</Show>
		</div>
	);
};

export default EmployeePreRegistrationView;
