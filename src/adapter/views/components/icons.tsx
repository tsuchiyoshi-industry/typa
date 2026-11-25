import { dynamic, type JSX } from "@solidjs/web";
import {
	ArrowDown as ArrowDownShape,
	ArrowLeft as ArrowLeftShape,
	ArrowRight as ArrowRightShape,
	ArrowUp as ArrowUpShape,
	Award as AwardShape,
	BadgeCheck as BadgeCheckShape,
	BellOff as BellOffShape,
	Bell as BellShape,
	CalendarDays as CalendarDaysShape,
	Check as CheckShape,
	ChevronDown as ChevronDownShape,
	ChevronRight as ChevronRightShape,
	CircleAlert as CircleAlertShape,
	CircleCheck as CircleCheckShape,
	CircleDashed as CircleDashedShape,
	CirclePause as CirclePauseShape,
	CircleQuestionMark as CircleQuestionMarkShape,
	ClipboardCheck as ClipboardCheckShape,
	Columns3 as Columns3Shape,
	Download as DownloadShape,
	Eye as EyeShape,
	FileCheck as FileCheckShape,
	FileDown as FileDownShape,
	FilePlusCorner as FilePlusCornerShape,
	FileText as FileTextShape,
	FileUp as FileUpShape,
	Hourglass as HourglassShape,
	type IconNode,
	Inbox as InboxShape,
	Info as InfoShape,
	KeyRound as KeyRoundShape,
	Layers as LayersShape,
	ListChecks as ListChecksShape,
	ListFilter as ListFilterShape,
	List as ListShape,
	Lock as LockShape,
	LogOut as LogOutShape,
	Mail as MailShape,
	Menu as MenuShape,
	MessageSquareText as MessageSquareTextShape,
	Minus as MinusShape,
	Moon as MoonShape,
	Network as NetworkShape,
	PackageOpen as PackageOpenShape,
	PencilLine as PencilLineShape,
	Pin as PinShape,
	Plus as PlusShape,
	RefreshCw as RefreshCwShape,
	RotateCw as RotateCwShape,
	ScrollText as ScrollTextShape,
	Search as SearchShape,
	Send as SendShape,
	Settings as SettingsShape,
	ShieldAlert as ShieldAlertShape,
	ShieldCheck as ShieldCheckShape,
	SquarePen as SquarePenShape,
	Sun as SunShape,
	Ticket as TicketShape,
	Trash as TrashShape,
	Undo2 as Undo2Shape,
	UserPlus as UserPlusShape,
	UserRound as UserRoundShape,
	User as UserShape,
	Users as UsersShape,
	X as XShape,
	ZoomIn as ZoomInShape,
} from "lucide";
import { type Component, For } from "solid-js";

// lucide-solid は Solid 1 向け(splitProps・solid-js/web)で、Solid 2 では動かない。
// 形のデータだけを lucide から読み、SVG はここで組む。使うアイコンだけを書き出す(バンドルに入るのもその分だけ)。

export interface IconProps {
	size?: number;
	/** 2.0 の class と同じく、文字列・配列・オブジェクト(真偽で付け外し)が使える。 */
	class?: JSX.ClassValue;
	/** アイコンは飾り(意味はボタンや見出しの文字が持つ)なので、いつも読み上げから隠す。書いても同じ。 */
	"aria-hidden"?: "true";
	"stroke-width"?: number;
}
export type Icon = Component<IconProps>;

const icon =
	(shape: IconNode): Icon =>
	(props) => (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width={props.size ?? 24}
			height={props.size ?? 24}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width={props["stroke-width"] ?? 2}
			stroke-linecap="round"
			stroke-linejoin="round"
			class={["lucide", props.class]}
			aria-hidden="true"
		>
			<For each={shape}>
				{([tag, attrs]) => {
					// 形の要素(path・circle など)。形は変わらないので、要素ごとに一度だけ作る
					const Element = dynamic(() => tag);
					return <Element {...attrs} />;
				}}
			</For>
		</svg>
	);

export const ArrowDown = icon(ArrowDownShape);
export const ArrowLeft = icon(ArrowLeftShape);
export const ArrowRight = icon(ArrowRightShape);
export const ArrowUp = icon(ArrowUpShape);
export const Award = icon(AwardShape);
export const BadgeCheck = icon(BadgeCheckShape);
export const Bell = icon(BellShape);
export const BellOff = icon(BellOffShape);
export const CalendarDays = icon(CalendarDaysShape);
export const Check = icon(CheckShape);
export const ChevronDown = icon(ChevronDownShape);
export const ChevronRight = icon(ChevronRightShape);
export const CircleAlert = icon(CircleAlertShape);
export const CircleCheck = icon(CircleCheckShape);
export const CircleDashed = icon(CircleDashedShape);
export const CirclePause = icon(CirclePauseShape);
export const CircleQuestionMark = icon(CircleQuestionMarkShape);
export const ClipboardCheck = icon(ClipboardCheckShape);
export const Columns3 = icon(Columns3Shape);
export const Download = icon(DownloadShape);
export const Eye = icon(EyeShape);
export const FileCheck = icon(FileCheckShape);
export const FileDown = icon(FileDownShape);
export const FilePlusCorner = icon(FilePlusCornerShape);
export const FileText = icon(FileTextShape);
export const FileUp = icon(FileUpShape);
export const Hourglass = icon(HourglassShape);
export const Inbox = icon(InboxShape);
export const Info = icon(InfoShape);
export const KeyRound = icon(KeyRoundShape);
export const Layers = icon(LayersShape);
export const List = icon(ListShape);
export const ListChecks = icon(ListChecksShape);
export const ListFilter = icon(ListFilterShape);
export const Lock = icon(LockShape);
export const LogOut = icon(LogOutShape);
export const Mail = icon(MailShape);
export const Menu = icon(MenuShape);
export const MessageSquareText = icon(MessageSquareTextShape);
export const Minus = icon(MinusShape);
export const Moon = icon(MoonShape);
export const Network = icon(NetworkShape);
export const PackageOpen = icon(PackageOpenShape);
export const PencilLine = icon(PencilLineShape);
export const Pin = icon(PinShape);
export const Plus = icon(PlusShape);
export const RefreshCw = icon(RefreshCwShape);
export const RotateCw = icon(RotateCwShape);
export const ScrollText = icon(ScrollTextShape);
export const Search = icon(SearchShape);
export const Send = icon(SendShape);
export const Settings = icon(SettingsShape);
export const ShieldAlert = icon(ShieldAlertShape);
export const ShieldCheck = icon(ShieldCheckShape);
export const SquarePen = icon(SquarePenShape);
export const Sun = icon(SunShape);
export const Ticket = icon(TicketShape);
export const Trash = icon(TrashShape);
export const Undo2 = icon(Undo2Shape);
export const User = icon(UserShape);
export const UserPlus = icon(UserPlusShape);
export const UserRound = icon(UserRoundShape);
export const Users = icon(UsersShape);
export const X = icon(XShape);
export const ZoomIn = icon(ZoomInShape);
