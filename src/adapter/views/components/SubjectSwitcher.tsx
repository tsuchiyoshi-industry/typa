import Users from "lucide-solid/icons/users";
import { type Component, createMemo, Show } from "solid-js";
import type { EmployeeDto } from "../../../application/dtos/EmployeeDto";
import type { CategorizedSheetsDto, SheetSummaryDto } from "../../../application/dtos/SheetListDto";
import SearchableEvaluatorSelect from "./SearchableEvaluatorSelect";

interface SubjectSwitcherProps {
	/** いま開いているシートの id(ルートの値)。 */
	sheetId: string;
	periodId: number | undefined;
	subject: EmployeeDto | null | undefined;
	sheets: CategorizedSheetsDto;
	disabled: boolean;
	onPick: (sheetId: string) => Promise<boolean>;
}

/**
 * 表示するシートの切り替え。部下が多くても探せるよう、氏名・社員番号で絞り込める。
 * 同じ期間のシートだけを出す。一覧にまだ無いシート(読み込み中・一覧の対象外)も、いま開いている人として出す。
 * 切り替える先がなければ出さない。
 */
const SubjectSwitcher: Component<SubjectSwitcherProps> = (props) => {
	const optionsOf = (sheets: SheetSummaryDto[], mine: boolean) => {
		const seen = new Set<string>();
		return sheets
			.filter((item) => {
				if (item.periodId !== props.periodId || seen.has(item.employeeNo)) {
					return false;
				}
				seen.add(item.employeeNo);
				return true;
			})
			.map((item) => ({
				value: String(item.id),
				name: item.employeeName,
				employeeNo: mine ? `${item.employeeNo} · 自分` : item.employeeNo,
			}));
	};
	const options = createMemo(() => {
		const all = [
			...optionsOf(props.sheets.mySheets, true),
			...optionsOf(props.sheets.subordinateSheets, false),
		];
		return all.some((option) => option.value === props.sheetId)
			? all
			: [
					{
						value: props.sheetId,
						name: props.subject?.name ?? "読み込み中...",
						employeeNo: props.subject?.employeeNo,
					},
					...all,
				];
	});

	return (
		<Show when={options().length > 1}>
			<div class="subject-switcher">
				<span class="subject-switcher__label">
					<Users class="subject-switcher__icon" />
					シートを切り替え
				</span>
				<SearchableEvaluatorSelect
					label="表示する評価対象者"
					noun="評価対象者"
					value={props.sheetId}
					options={options()}
					disabled={props.disabled}
					saving={false}
					onPick={props.onPick}
				/>
			</div>
		</Show>
	);
};

export default SubjectSwitcher;
