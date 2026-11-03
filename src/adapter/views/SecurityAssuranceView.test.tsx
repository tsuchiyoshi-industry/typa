// @vitest-environment happy-dom
import { cleanup, render, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import requirements from "../../../security/requirements.json";
import type { SecurityAssuranceController } from "../controllers/SecurityAssuranceController";
import { buildSecurityAssurance } from "../viewmodels/securityAssurance";
import SecurityAssuranceView from "./SecurityAssuranceView";

afterEach(cleanup);

const show = (open: SecurityAssuranceController["open"]) =>
	render(() => <SecurityAssuranceView controller={{ open } as SecurityAssuranceController} />);

it("lists every required CI check with its ID, and what is left unverified", async () => {
	const view = show(async () => buildSecurityAssurance());
	const gates = await view.findByRole("region", { name: "配布の前に毎回通す検査" });
	for (const requirement of requirements.required) {
		expect(within(gates).getByText(requirement.id)).toBeTruthy();
	}
	expect(view.getByRole("region", { name: "人事評価ならではの不正" })).toBeTruthy();
	expect(view.getByRole("region", { name: "担保していない範囲" })).toBeTruthy();
	expect(view.getByText(/OWASP ASVS 5\.0\.0 から選んだ要件/)).toBeTruthy();
});

it("shows only the refusal when the controller refuses", async () => {
	const view = show(async () => {
		throw new Error("セキュリティの担保は Admin のみ利用できます。");
	});
	expect((await view.findByRole("alert")).textContent).toContain("Admin のみ");
	expect(view.queryByRole("region", { name: "配布の前に毎回通す検査" })).toBeNull();
	expect(view.queryByText("ACCESS-BOLA")).toBeNull();
});
