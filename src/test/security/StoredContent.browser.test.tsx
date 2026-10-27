import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { PeriodGoalsList } from "../../adapter/views/components/PeriodGoals";

// ASVS v5.0.0 V1.2.1 / V3.2.2: Chromium上で実際の業務コンポーネントを描画する。
// happy-domで「scriptが実行されなかった」だけをXSS耐性の根拠にしない。
afterEach(cleanup);

it.each([
	'<script>document.documentElement.dataset.securityProbe="executed"</script>',
	'<img src="/missing-security-probe" onerror="document.documentElement.dataset.securityProbe=\'executed\'">',
	"<svg onload=\"document.documentElement.dataset.securityProbe='executed'\"></svg>",
	"<iframe srcdoc=\"<script>parent.document.documentElement.dataset.securityProbe='executed'</script>\"></iframe>",
	"<a href=\"javascript:document.documentElement.dataset.securityProbe='executed'\">open</a>",
	'</p><form id="location"><input name="href"></form><p>',
])("renders persisted goal content as text: %s", async (payload) => {
	delete document.documentElement.dataset.securityProbe;
	const { container } = render(() => (
		<PeriodGoalsList goals={[{ description: payload, achievement: payload }]} />
	));
	expect(container.textContent?.split(payload)).toHaveLength(3);
	expect(container.querySelector("script,img,svg,iframe,a,form,input")).toBeNull();
	// 実行可能なノードが作られないことが主たるアサーション。イベントも1フレーム待つ。
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	expect(document.documentElement.dataset.securityProbe).toBeUndefined();
});

it("also renders a challenge's standalone achievement as text", () => {
	const payload = '<img src=x onerror="alert(document.cookie)">';
	const { container } = render(() => <PeriodGoalsList goals={[]} achievement={payload} />);
	expect(container.textContent).toContain(payload);
	expect(container.querySelector("img")).toBeNull();
});
