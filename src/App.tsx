import { Navigate, Route, Router } from "@solidjs/router";
import type { Session } from "@supabase/supabase-js";
import { LogOut, Menu, User, X } from "lucide-solid";
import { type Component, createSignal, type JSX, onMount, Show } from "solid-js";
import { supabase } from "../utils/supabase";
import Login from "./components/Login";
import SheetEditor from "./components/SheetEditor";
import SheetList from "./components/SheetList";

const AppLayout: Component<{ children?: JSX.Element | JSX.Element[] }> = (props) => (
	<div class="app-shell">
		<div class="app-frame">{props.children}</div>
	</div>
);

const DashboardLayout: Component<{ children?: JSX.Element | JSX.Element[] }> = (props) => {
	const [menuOpen, setMenuOpen] = createSignal(false);
	const [userMenuOpen, setUserMenuOpen] = createSignal(false);
	const [userEmail, setUserEmail] = createSignal<string>("");

	onMount(async () => {
		const {
			data: { user },
		} = await supabase.auth.getUser();
		if (user?.email) {
			setUserEmail(user.email);
		}

		// メニュー外クリックで閉じる
		const handleClickOutside = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (!target.closest(".user-menu-container")) {
				setUserMenuOpen(false);
			}
		};
		document.addEventListener("click", handleClickOutside);
		return () => document.removeEventListener("click", handleClickOutside);
	});

	const handleLogout = async () => {
		await supabase.auth.signOut();
		setUserMenuOpen(false);
	};

	return (
		<div class="dashboard-shell">
			<header class="dashboard-topbar">
				<div class="topbar-brand">
					<span class="brand-logo">TYPA</span>
				</div>
				<button
					type="button"
					class="menu-toggle"
					onClick={() => setMenuOpen(!menuOpen())}
					aria-label="メニュー"
				>
					<Show when={menuOpen()} fallback={<Menu size={24} />}>
						<X size={24} />
					</Show>
				</button>
				<nav class="topbar-nav" classList={{ "nav-open": menuOpen() }}>
					<a href="/employees" class="nav-link" onClick={() => setMenuOpen(false)}>
						従業員マスタ
					</a>
					<a href="/common-evaluation" class="nav-link" onClick={() => setMenuOpen(false)}>
						共通評価マスタ
					</a>
					<a href="/" class="nav-link" onClick={() => setMenuOpen(false)}>
						評価シート一覧
					</a>
				</nav>
				<div class="user-menu-container">
					<button
						type="button"
						class="user-menu-trigger"
						onClick={() => setUserMenuOpen(!userMenuOpen())}
						aria-label="ユーザーメニュー"
					>
						<User size={20} />
						<span class="user-email">{userEmail()}</span>
					</button>
					<Show when={userMenuOpen()}>
						<div class="user-menu-dropdown">
							<button type="button" class="user-menu-item logout-item" onClick={handleLogout}>
								<LogOut size={18} />
								<span>ログアウト</span>
							</button>
						</div>
					</Show>
				</div>
			</header>
			<main class="dashboard-main">{props.children}</main>
		</div>
	);
};

const NotFound: Component = () => (
	<div class="notfound-card">
		<h1>404</h1>
		<p>申し訳ありません。指定されたページは見つかりませんでした。</p>
	</div>
);

const App: Component = () => {
	const [session, setSession] = createSignal<Session | null>(null);
	const [initialized, setInitialized] = createSignal(false);

	onMount(() => {
		supabase.auth.getSession().then(({ data: { session } }) => {
			setSession(session);
			setInitialized(true);
		});

		const {
			data: { subscription },
		} = supabase.auth.onAuthStateChange((_event, session) => {
			setSession(session);
		});

		return () => subscription.unsubscribe();
	});

	return (
		<Show when={initialized()}>
			<Router root={AppLayout}>
				<Route
					path="/"
					component={() => (
						<Show when={session()} fallback={<Navigate href="/login" />}>
							<DashboardLayout>
								<SheetList />
							</DashboardLayout>
						</Show>
					)}
				/>

				<Route
					path="/sheet/:id"
					component={() => (
						<Show when={session()} fallback={<Navigate href="/login" />}>
							<DashboardLayout>
								<SheetEditor />
							</DashboardLayout>
						</Show>
					)}
				/>

				<Route
					path="/login"
					component={() => (
						<Show when={!session()} fallback={<Navigate href="/" />}>
							<Login />
						</Show>
					)}
				/>

				<Route
					path="*404"
					component={() => (
						<Show when={session()} fallback={<Navigate href="/login" />}>
							<DashboardLayout>
								<NotFound />
							</DashboardLayout>
						</Show>
					)}
				/>
			</Router>
		</Show>
	);
};

export default App;
