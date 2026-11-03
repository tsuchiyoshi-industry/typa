import ShieldCheck from "lucide-solid/icons/shield-check";
import { type Component, createSignal, For, onMount, Show } from "solid-js";
import { messageOf } from "../../application/errorMessage";
import type { SecurityAssuranceController } from "../controllers/SecurityAssuranceController";
import type {
	AttackCoverage,
	SecurityAssuranceView as View,
} from "../viewmodels/securityAssurance";
import "./styles/security.css";

const COVERAGE: Record<AttackCoverage, string> = {
	every: "毎回、実際に試す",
	config: "設定を検査",
	design: "作りの上で起きない",
};

/** 何が安全として担保されているか(Admin だけ)。中身は CI のセキュリティ検査から組み立てる。 */
const SecurityAssuranceView: Component<{ controller: SecurityAssuranceController }> = (props) => {
	const [view, setView] = createSignal<View>();
	const [refused, setRefused] = createSignal("");

	onMount(async () => {
		try {
			setView(await props.controller.open());
		} catch (error) {
			setRefused(messageOf(error, "セキュリティの担保を開けませんでした。"));
		}
	});

	return (
		<div class="assurance">
			<header class="master-header">
				<div>
					<h1>
						<ShieldCheck class="header-icon" aria-hidden="true" />
						セキュリティ
					</h1>
					<p class="assurance-lead">
						TYPA は版を配布する前に、本物のログイン・データベース・API
						に対して攻撃や不正な操作を実際に試し、すべて断られたことを確かめます。1つでも通れば、その版は配布されません。ここでは、その検査で何が担保されているかを示します。
					</p>
				</div>
			</header>

			<Show
				when={!refused()}
				fallback={
					<p class="assurance-refused" role="alert">
						{refused()}
					</p>
				}
			>
				<Show when={view()} fallback={<p class="page-note">読み込んでいます...</p>}>
					{(data) => (
						<>
							<dl class="assurance-facts">
								<div>
									<dt>配布の前に毎回通す検査</dt>
									<dd>
										{data().gates.reduce((sum, group) => sum + group.checks.length, 0)}
										<small>件</small>
									</dd>
								</div>
								<div>
									<dt>検査する DB（新規構築と移行後）</dt>
									<dd>
										{data().databases}
										<small>通り</small>
									</dd>
								</div>
								<div>
									<dt>人事評価ならではの不正への備え</dt>
									<dd>
										{data().misuse.length}
										<small>件</small>
									</dd>
								</div>
								<div>
									<dt>よく知られた攻撃への備え</dt>
									<dd>
										{data().attacks.length}
										<small>種</small>
									</dd>
								</div>
							</dl>

							<section class="assurance-section" aria-labelledby="assurance-gates">
								<h2 id="assurance-gates">配布の前に毎回通す検査</h2>
								<p class="assurance-section__lead">
									画面を通さず API
									を直接呼ぶ攻撃も含めて試します。画面でボタンを隠すことは、守りとして数えません。断った後は、保存内容が変わっていないことまで確かめます。
								</p>
								<For each={data().gates}>
									{(group) => (
										<div class="assurance-group">
											<h3>{group.title}</h3>
											<ul class="assurance-checks">
												<For each={group.checks}>
													{(check) => (
														<li>
															<h4>{check.title}</h4>
															<p>{check.guarantee}</p>
															<p class="assurance-checks__ids">
																<code>{check.id}</code>
																<For each={check.asvs}>
																	{(number) => <span>ASVS {number}</span>}
																</For>
															</p>
														</li>
													)}
												</For>
											</ul>
										</div>
									)}
								</For>
							</section>

							<section class="assurance-section" aria-labelledby="assurance-misuse">
								<h2 id="assurance-misuse">人事評価ならではの不正</h2>
								<p class="assurance-section__lead">
									評価の仕組みを知っている内部の人が、画面にない操作を試すことを想定しています。どれも
									DB が断り、画面の作りに頼りません。
								</p>
								<div class="assurance-table-wrap">
									<table class="assurance-table">
										<thead>
											<tr>
												<th scope="col">試される不正</th>
												<th scope="col">防ぎ方</th>
												<th scope="col">確かめている検査</th>
											</tr>
										</thead>
										<tbody>
											<For each={data().misuse}>
												{(row) => (
													<tr>
														<th scope="row">{row.misuse}</th>
														<td>{row.defense}</td>
														<td>{row.evidence}</td>
													</tr>
												)}
											</For>
										</tbody>
									</table>
								</div>
							</section>

							<section class="assurance-section" aria-labelledby="assurance-attacks">
								<h2 id="assurance-attacks">よく知られた攻撃</h2>
								<ul class="assurance-attacks">
									<For each={data().attacks}>
										{(attack) => (
											<li>
												<strong>{attack.name}</strong>
												<span
													class="assurance-coverage"
													classList={{
														[`assurance-coverage--${attack.coverage}`]: true,
													}}
												>
													{COVERAGE[attack.coverage]}
												</span>
												<p>{attack.detail}</p>
											</li>
										)}
									</For>
								</ul>
							</section>

							<section class="assurance-section" aria-labelledby="assurance-watch">
								<h2 id="assurance-watch">変更そのものを見張る</h2>
								<p class="assurance-section__lead">
									守りは、一度作っても改修で抜けることがあります。変更のたびに、守りが残っていることを機械で確かめます。
								</p>
								<ul class="assurance-watch">
									<For each={data().watch}>
										{(item) => (
											<li>
												<h3>{item.title}</h3>
												<p>{item.detail}</p>
											</li>
										)}
									</For>
								</ul>
							</section>

							<section class="assurance-section" aria-labelledby="assurance-limits">
								<h2 id="assurance-limits">担保していない範囲</h2>
								<p class="assurance-section__lead">
									検査が確かめていないことです。運用と本番の設定で補ってください。
								</p>
								<ul class="assurance-limits">
									<For each={data().limits}>
										{(limit) => (
											<li>
												<h3>{limit.title}</h3>
												<p>{limit.detail}</p>
											</li>
										)}
									</For>
								</ul>
								<p class="assurance-standard">
									{`${data().standard} から選んだ要件を、変更のたびに確かめる検査です。ASVS の認定や、全項目への適合を示すものではありません。`}
								</p>
							</section>
						</>
					)}
				</Show>
			</Show>
		</div>
	);
};
export default SecurityAssuranceView;
