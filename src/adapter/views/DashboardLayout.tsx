import { A, useLocation } from "@solidjs/router";
import ChevronDown from "lucide-solid/icons/chevron-down";
import CircleQuestionMark from "lucide-solid/icons/circle-question-mark";
import LogOut from "lucide-solid/icons/log-out";
import Menu from "lucide-solid/icons/menu";
import Settings from "lucide-solid/icons/settings";
import User from "lucide-solid/icons/user";
import X from "lucide-solid/icons/x";
import { type Component, createSignal, type JSX, onCleanup, onMount, Show } from "solid-js";
import type { AccountController, CurrentUserDto } from "../controllers/AccountController";
import ThemeMenuItem from "./components/ThemeMenuItem";
import { clearUnsavedChanges, confirmDiscard } from "./feedback";

/** ログイン後の画面に共通のトップバー。ページ移動のたびに作り直さない。 */
const DashboardLayout: Component<{
	controller: AccountController;
	children?: JSX.Element | JSX.Element[];
}> = (props) => {
	const location = useLocation();
	const [menuOpen, setMenuOpen] = createSignal(false);
	const [userMenuOpen, setUserMenuOpen] = createSignal(false);
	const [user, setUser] = createSignal<CurrentUserDto | null>(null);
	let mounted = true;

	// メニューの外を押したら閉じる。片方を開くと、もう片方は外側のクリックとして閉じる
	const handleClickOutside = (e: MouseEvent) => {
		const target = e.target as Element;
		if (!target.closest(".user-menu-container")) {
			setUserMenuOpen(false);
		}
		if (!target.closest(".topbar-nav, .menu-toggle")) {
			setMenuOpen(false);
		}
	};
	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			setUserMenuOpen(false);
			setMenuOpen(false);
		}
	};

	onMount(() => {
		document.addEventListener("click", handleClickOutside);
		document.addEventListener("keydown", handleKeyDown);
		void props.controller
			.currentUser()
			.then((current) => mounted && setUser(current))
			.catch(() => undefined);
	});
	onCleanup(() => {
		mounted = false;
		document.removeEventListener("click", handleClickOutside);
		document.removeEventListener("keydown", handleKeyDown);
	});

	// シートの画面は一覧から開くので、一覧を現在地として扱う
	const onSheetPage = () => location.pathname === "/" || location.pathname.startsWith("/sheet/");

	const handleLogout = async () => {
		setUserMenuOpen(false);
		if (!(await confirmDiscard())) {
			return;
		}
		clearUnsavedChanges();
		await props.controller.signOut();
	};

	return (
		<div class="dashboard-shell">
			<header class="dashboard-topbar">
				<A href="/" class="topbar-brand" aria-label="TYPA 評価シート一覧へ">
					<span class="brand-logo">TYPA</span>
				</A>
				<nav
					id="main-nav"
					class="topbar-nav"
					aria-label="メインナビゲーション"
					classList={{ "nav-open": menuOpen() }}
				>
					<A
						href="/"
						end
						class="nav-link"
						classList={{ active: onSheetPage() }}
						onClick={() => setMenuOpen(false)}
					>
						評価シート
					</A>
					<A href="/review" class="nav-link" onClick={() => setMenuOpen(false)}>
						部下の評価
					</A>
					<A href="/employee-master" class="nav-link" onClick={() => setMenuOpen(false)}>
						社員マスタ
					</A>
				</nav>
				<div class="user-menu-container">
					<button
						type="button"
						class="user-menu-trigger"
						onClick={() => setUserMenuOpen(!userMenuOpen())}
						aria-label="ユーザーメニュー"
						aria-controls="user-menu"
						aria-expanded={userMenuOpen()}
					>
						<User size={18} />
						<span class="user-name">{user()?.name}</span>
						<ChevronDown size={14} class="user-menu-caret" />
					</button>
					<Show when={userMenuOpen()}>
						<div id="user-menu" class="user-menu-dropdown">
							<Show when={user()}>
								{(person) => (
									<div class="user-menu-profile">
										<strong>{person().name}</strong>
										<span>
											{person().employeeNo}
											<span class="user-role">{person().role}</span>
										</span>
									</div>
								)}
							</Show>
							<ThemeMenuItem />
							<Show when={user()?.canViewSettings}>
								<A href="/settings" class="user-menu-item" onClick={() => setUserMenuOpen(false)}>
									<Settings size={18} />
									<span>設定</span>
								</A>
							</Show>
							<A href="/help" class="user-menu-item" onClick={() => setUserMenuOpen(false)}>
								<CircleQuestionMark size={18} />
								<span>ヘルプ</span>
							</A>
							<button type="button" class="user-menu-item logout-item" onClick={handleLogout}>
								<LogOut size={18} />
								<span>ログアウト</span>
							</button>
						</div>
					</Show>
				</div>
				<button
					type="button"
					class="menu-toggle"
					onClick={() => setMenuOpen(!menuOpen())}
					aria-label="メニュー"
					aria-controls="main-nav"
					aria-expanded={menuOpen()}
				>
					<Show when={menuOpen()} fallback={<Menu size={22} />}>
						<X size={22} />
					</Show>
				</button>
			</header>
			<main class="dashboard-main">{props.children}</main>
		</div>
	);
};

export default DashboardLayout;
