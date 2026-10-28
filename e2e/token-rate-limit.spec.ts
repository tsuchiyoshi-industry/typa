import { expect, test } from "@playwright/test";
import { ADMIN, restAs, signIn, signOut } from "./support";

// Run after the business workflows: deliberately emptying the shared token
// bucket first would add rate-limit waits to the long evaluation scenario.
test("REST assertions and UI sign-in recover after the shared Auth IP hits its burst limit", async ({
	page,
}) => {
	// Reproduce fast CI: successful and failed password grants consume the same
	// bucket. Use invalid credentials so the burst does not create extra sessions.
	let limited = false;
	for (let attempt = 0; attempt < 45; attempt++) {
		const response = await fetch(`${process.env.E2E_API_URL}/auth/v1/token?grant_type=password`, {
			method: "POST",
			headers: {
				apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				email: "typa-release001@release.example",
				password: "wrong-synthetic-password",
			}),
		});
		const body = await response.json();
		if (response.status === 429) {
			expect(body.error_code).toBe("over_request_rate_limit");
			limited = true;
			break;
		}
		expect(response.status).toBe(400);
		expect(body.error_code).toBe("invalid_credentials");
	}
	expect(limited, "The real Auth IP limiter must remain enabled").toBe(true);

	const admin = await restAs(1);
	const employees = await admin("employees?employee_no=eq.RELEASE001&select=employee_no");
	expect(employees.status).toBe(200);
	expect(await employees.json()).toEqual([{ employee_no: ADMIN }]);

	await signIn(page, ADMIN);
	await expect(page.getByRole("heading", { name: "評価シート一覧" })).toBeVisible();
	await signOut(page);
});
