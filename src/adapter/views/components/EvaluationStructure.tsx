import { type Component, createMemo, For, Show } from "solid-js";
import type { ApprovalRelationDto } from "../../../application/dtos/EmployeeMasterDto";
import { buildEvaluationStructure } from "../../viewmodels/evaluationStructure";

interface EvaluationStructureProps {
	relations: ApprovalRelationDto[];
	/** 自分の社員ID。自分の名前を目立たせる。 */
	currentEmployeeId?: number;
	/** 社員を選んだとき。一覧に戻って、その社員の設定を開くのに使う。 */
	onPick: (relation: ApprovalRelationDto) => void;
}

/**
 * 評価の構造を「二次評価者(最終評価) ← 一次評価者 ← 社員」の3列で示す。
 * 左から右へたどると、誰の評価を誰が確定するかが分かる。縦にだけ伸び、横には広がらない。
 */
const EvaluationStructure: Component<EvaluationStructureProps> = (props) => {
	const finals = createMemo(() => buildEvaluationStructure(props.relations));

	return (
		<div class="structure">
			<div class="structure-head" aria-hidden="true">
				<span>二次評価者（最終評価）</span>
				<span>一次評価者</span>
				<span>評価される社員</span>
			</div>
			<For each={finals()}>
				{(final) => (
					<section
						class="structure-final"
						classList={{ unset: final.kind === "unset" }}
						aria-label={`${final.name}が最終評価をする ${final.total}名`}
					>
						<div class="structure-node final">
							<strong>{final.name}</strong>
							<small>
								{final.kind === "none" ? "一次評価が最終評価 · " : ""}
								{final.total}名
							</small>
						</div>
						<ul class="structure-primaries">
							<For each={final.primaries}>
								{(primary) => (
									<li class="structure-primary" classList={{ unset: primary.unset }}>
										<div class="structure-node">
											<strong>{primary.name}</strong>
											<small>{primary.members.length}名</small>
										</div>
										<ul
											class="structure-members"
											aria-label={`${primary.name}が一次評価をする社員`}
										>
											<For each={primary.members}>
												{(member) => (
													<li>
														<button
															type="button"
															class="structure-chip"
															classList={{ me: member.employeeId === props.currentEmployeeId }}
															title={`${member.employeeNo} · ${member.gradeName}（押すと一覧で開きます）`}
															onClick={() => props.onPick(member)}
														>
															{member.name}
														</button>
													</li>
												)}
											</For>
										</ul>
									</li>
								)}
							</For>
						</ul>
					</section>
				)}
			</For>
			<Show when={finals().length === 0}>
				<p class="master-empty">表示できる社員がいません。</p>
			</Show>
		</div>
	);
};

export default EvaluationStructure;
