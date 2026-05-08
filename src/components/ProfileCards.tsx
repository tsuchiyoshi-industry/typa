import { User, Users } from "lucide-solid";
import { type Component, createEffect, createSignal } from "solid-js";
import { fetchGradeName } from "./helpers/employeeGrade";
import type { Employee } from "./helpers/evaluationSheet";

interface ProfileCardsProps {
	subject: Employee;
	evaluationPeriodName: string;
	primaryEvaluator: string;
	secondaryEvaluator: string;
}

const ProfileCards: Component<ProfileCardsProps> = (props) => {
	const [gradeName, setGradeName] = createSignal<string>("未設定");

	createEffect(() => {
		fetchGradeName(props.subject.grade_id ?? null).then(setGradeName);
	});

	return (
		<div class="sheet-grid">
			<article class="sheet-card">
				<h2 class="profile-card-heading">
					<User />
					被評価者プロファイル
				</h2>
				<dl class="profile-list">
					<div class="profile-item">
						<dt>キャリアコース区分</dt>
						<dd>{props.subject.career_course ?? "未設定"}</dd>
					</div>
					<div class="profile-item">
						<dt>等級</dt>
						<dd>{gradeName()}</dd>
					</div>
					<div class="profile-item">
						<dt>評価対象期間</dt>
						<dd>{props.evaluationPeriodName ?? "未設定"}</dd>
					</div>
					<div class="profile-item">
						<dt>社員番号</dt>
						<dd>{props.subject.employee_no ?? "――"}</dd>
					</div>
					<div class="profile-item">
						<dt>氏名</dt>
						<dd>{props.subject.name ?? "――"}</dd>
					</div>
				</dl>
			</article>

			<article class="sheet-card">
				<h2 class="profile-card-heading">
					<Users />
					評価者プロファイル
				</h2>
				<dl class="profile-list">
					<div class="profile-item">
						<dt>一次評価者</dt>
						<dd>{props.primaryEvaluator}</dd>
					</div>
					<div class="profile-item">
						<dt>二次評価者</dt>
						<dd>{props.secondaryEvaluator}</dd>
					</div>
				</dl>
			</article>
		</div>
	);
};

export default ProfileCards;
