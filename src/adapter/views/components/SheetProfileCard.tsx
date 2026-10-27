import CalendarDays from "lucide-solid/icons/calendar-days";
import User from "lucide-solid/icons/user";
import Users from "lucide-solid/icons/users";
import type { Component } from "solid-js";
import type { EvaluationSheetDto } from "../../../application/dtos/EvaluationSheetDto";

/** 評価対象者・評価期間・評価者。 */
const SheetProfileCard: Component<{ sheet: EvaluationSheetDto }> = (props) => (
	<section class="sheet-info-card">
		<div class="info-grid">
			<div class="info-item">
				<User class="info-icon" />
				<div class="info-content">
					<span class="info-label">評価対象者</span>
					<span class="info-value">{props.sheet.subject?.name ?? "—"}</span>
					<span class="info-meta">
						{props.sheet.subject?.employeeNo ?? "—"} / {props.sheet.subject?.gradeName ?? "—"}
					</span>
				</div>
			</div>
			<div class="info-item">
				<CalendarDays class="info-icon" />
				<div class="info-content">
					<span class="info-label">評価期間</span>
					<span class="info-value">{props.sheet.evaluationPeriod?.periodName ?? "—"}</span>
					<span class="info-meta">
						{props.sheet.evaluationPeriod?.startDate ?? "—"} 〜{" "}
						{props.sheet.evaluationPeriod?.endDate ?? "—"}
					</span>
				</div>
			</div>
			<div class="info-item">
				<Users class="info-icon" />
				<div class="info-content">
					<span class="info-label">評価者</span>
					<div class="evaluator-list">
						<span class="evaluator-item">
							<span class="evaluator-badge">1次</span>
							{props.sheet.primaryEvaluator ?? "未設定"}
						</span>
						<span class="evaluator-item">
							<span class="evaluator-badge">2次</span>
							{props.sheet.secondaryEvaluator ?? "未設定"}
						</span>
					</div>
				</div>
			</div>
		</div>
	</section>
);

export default SheetProfileCard;
