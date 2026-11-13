import { expect, it } from "vitest";
import { masterRepository, output, profile } from "../../test/fixtures";
import { ResetEmployeePasswordInteractor } from "./ResetEmployeePasswordInteractor";

function setup() {
	const employees = masterRepository();
	employees.findCurrentEmployeeProfile.mockResolvedValue(profile("Admin", 9));
	employees.findByEmployeeNo.mockResolvedValue(profile("Employee", 1));
	const out = output<{ success: boolean; message: string }>();
	const run = (password = "NewPass123", targetEmployeeNo = " TEST001 ") =>
		new ResetEmployeePasswordInteractor(employees).execute({ targetEmployeeNo, password }, out);
	return { employees, out, run };
}
const refused = (message: RegExp | string) =>
	expect.objectContaining({ success: false, message: expect.stringMatching(message) });

it("sets a temporary password, keeping the registration, and says the employee must change it", async () => {
	const c = setup();
	await c.run();
	expect(c.employees.resetPasswordByEmployeeNo).toHaveBeenCalledWith("TEST001", "NewPass123");
	expect(c.employees.resetRegistrationByEmployeeNo).not.toHaveBeenCalled();
	expect(c.out.present).toHaveBeenCalledWith({
		success: true,
		message: expect.stringMatching(/テスト1さん.*仮のパスワード.*最初のログインで/),
	});
});

it.each([
	["nobody signed in", null],
	["an Employee", profile("Employee")],
	["a Reviewer", profile("Reviewer")],
	["a suspended Admin", profile("Admin", 9, true, false)],
	["an unregistered Admin", profile("Admin", 9, false)],
])("refuses %s without touching the account", async (_who, caller) => {
	const c = setup();
	c.employees.findCurrentEmployeeProfile.mockResolvedValue(caller);
	await c.run();
	expect(c.employees.resetPasswordByEmployeeNo).not.toHaveBeenCalled();
	expect(c.out.present).toHaveBeenCalledWith(refused("権限がありません"));
});

it.each(["", "short", "lowercase123", "UPPERCASE123", "NoNumbersHere", `Aa1${"x".repeat(70)}`])(
	"refuses a password Auth would not accept (%s) before asking the DB",
	async (password) => {
		const c = setup();
		await c.run(password);
		expect(c.employees.findByEmployeeNo).not.toHaveBeenCalled();
		expect(c.employees.resetPasswordByEmployeeNo).not.toHaveBeenCalled();
		expect(c.out.present).toHaveBeenCalledWith(refused("大文字・小文字・数字"));
	},
);

it.each([
	["an unknown employee", null, "見つかりません"],
	["an unregistered employee", profile("Employee", 1, false), "まだ登録していません"],
	["a suspended employee", profile("Employee", 1, true, false), "利用停止中"],
	["the operator", profile("Admin", 9), "自分のパスワード"],
])("refuses %s, as the domain says", async (_case, target, message) => {
	const c = setup();
	c.employees.findByEmployeeNo.mockResolvedValue(target);
	await c.run();
	expect(c.employees.resetPasswordByEmployeeNo).not.toHaveBeenCalled();
	expect(c.out.present).toHaveBeenCalledWith(refused(message));
});

it("reports a DB refusal (the employee changed meanwhile) without claiming success", async () => {
	const c = setup();
	c.employees.resetPasswordByEmployeeNo.mockResolvedValue(false);
	await c.run();
	expect(c.out.present).toHaveBeenCalledWith(refused("読み込み直して"));
});

it("lets a failed connection surface as an error", async () => {
	const c = setup();
	c.employees.resetPasswordByEmployeeNo.mockRejectedValue(new Error("unavailable"));
	await expect(c.run()).rejects.toThrow("unavailable");
	expect(c.out.present).not.toHaveBeenCalled();
});
