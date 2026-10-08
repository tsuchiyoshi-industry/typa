import { expect, it, vi } from "vitest";
import { employeeRepository } from "../../test/fixtures";
import { requireCurrentEmployeeId } from "./currentEmployee";

it.each([
	[{ data: 7, error: null }, 7, null],
	[{ data: null, error: null }, null, "ログインが必要です。"],
	[{ data: null, error: new Error("JWT expired") }, null, "認証エラー: JWT expired"],
	// ID が取れていても、エラーがあれば使わない
	[{ data: 7, error: new Error("JWT expired") }, null, "認証エラー: JWT expired"],
])("resolves the signed-in employee (%o)", async (result, expected, message) => {
	const employees = employeeRepository();
	employees.findCurrentEmployeeId.mockResolvedValue(result);
	const presentError = vi.fn();
	expect(await requireCurrentEmployeeId(employees, presentError)).toBe(expected);
	if (message) {
		expect(presentError).toHaveBeenCalledWith(message);
	} else {
		expect(presentError).not.toHaveBeenCalled();
	}
});
