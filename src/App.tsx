import { Navigate, Route, Router } from "@solidjs/router";
import type { Session } from "@supabase/supabase-js";
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

const DashboardLayout: Component<{ children?: JSX.Element | JSX.Element[] }> = (props) => (
	<div class="dashboard-shell">
		<aside class="dashboard-sidebar">
			<div class="sidebar-brand">
				<p>TYPA</p>
			</div>
			<nav class="sidebar-menu">
				<a href="/" class="sidebar-link active">
					評価シート
				</a>
				<a href="/reviews" class="sidebar-link">
					評価履歴
				</a>
				<a href="/settings" class="sidebar-link">
					設定
				</a>
			</nav>
		</aside>
		<div class="dashboard-main">{props.children}</div>
	</div>
);

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
