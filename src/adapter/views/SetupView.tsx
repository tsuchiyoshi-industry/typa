import { type Component, createMemo, Errored, For, Loading, Show } from "solid-js";
import { messageOf } from "../../application/errorMessage";
import type { AccountController } from "../controllers/AccountController";
import { FileUp, ListChecks, PackageOpen, UserPlus } from "./components/icons";

// ponytail: 導入チェックは名前だけ。中身ができたら href を付ける
const TASKS = [
	{
		icon: FileUp,
		title: "データ取込",
		description:
			"評価期間(実施中か締め済み)を選んで、目標・共通評価と点数を CSV でまとめて取り込みます。",
		href: "/setup/import",
	},
	{
		icon: UserPlus,
		title: "初期ユーザ",
		description: "社員を社員マスタに仮登録します。登録した社員には招待コードを渡します。",
		href: "/setup/employees",
	},
	{
		icon: ListChecks,
		title: "導入チェック",
		description: "評価期間・配点・通知メールの設定漏れを確認します。",
		href: null,
	},
];

/** システムを使い始めるときに一度だけ行う処理の入口。Admin だけが使える。 */
const SetupView: Component<{ controller: AccountController }> = (props) => {
	const user = createMemo(() => props.controller.currentUser());

	return (
		<div class="settings-page">
			<header class="master-header">
				<div>
					<h1>
						<PackageOpen class="header-icon" />
						導入処理
					</h1>
					<p>システムを使い始めるときに行う処理です。Admin だけが実行できます。</p>
				</div>
			</header>

			<Errored
				fallback={(error) => (
					<p class="page-note">読み込めませんでした。({messageOf(error(), "")})</p>
				)}
			>
				<Loading fallback={<p class="page-note">読み込んでいます...</p>}>
					<Show
						when={user()?.canRunSetup}
						fallback={<p class="page-note">導入処理は Admin のみ利用できます。</p>}
					>
						<ul class="setup-tasks">
							<For each={TASKS}>
								{(task) => (
									<li>
										<Show
											when={task.href}
											fallback={
												<div class="info-card setup-task--pending">
													<task.icon class="header-icon" aria-hidden="true" />
													<div>
														<h2>{task.title}</h2>
														<p>{task.description}</p>
													</div>
													<span class="period-badge">開発中</span>
												</div>
											}
										>
											{(href) => (
												<a href={href()} class="info-card setup-task-link">
													<task.icon class="header-icon" aria-hidden="true" />
													<div>
														<h2>{task.title}</h2>
														<p>{task.description}</p>
													</div>
												</a>
											)}
										</Show>
									</li>
								)}
							</For>
						</ul>
					</Show>
				</Loading>
			</Errored>
		</div>
	);
};

export default SetupView;
