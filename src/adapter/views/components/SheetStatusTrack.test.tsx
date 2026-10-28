// @vitest-environment happy-dom
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import SheetStatusTrack from "./SheetStatusTrack";

afterEach(cleanup);

const track = (
	status: "goals_confirmed" | "submitted" | "finalized",
	holder: Parameters<typeof SheetStatusTrack>[0]["holder"],
) =>
	render(() => (
		<SheetStatusTrack
			status={status}
			primaryIsFinal={false}
			canSubmit={false}
			canRevert={false}
			canConfirmFirst={false}
			canFinalize={false}
			updating={false}
			notice={null}
			holder={holder}
			onSubmit={() => {}}
			onRevert={() => {}}
			onConfirmFirst={() => {}}
			onFinalize={() => {}}
		/>
	));

it("目標確定の後は「振り返り待ち」で、いまの担当は本人", () => {
	track("goals_confirmed", { actor: "subject", name: "山田 太郎" });
	expect(screen.getByRole("listitem", { current: "step" }).textContent).toContain("振り返り待ち");
	expect(screen.getByText("いまの担当：本人（山田 太郎）")).toBeTruthy();
});

it("一次評価待ちの担当は一次評価者", () => {
	track("submitted", { actor: "primary", name: "佐藤 花子" });
	expect(screen.getByText("いまの担当：一次評価者（佐藤 花子）")).toBeTruthy();
});

it("評価確定には担当を出さない", () => {
	track("finalized", null);
	expect(screen.queryByText(/いまの担当/)).toBeNull();
});
