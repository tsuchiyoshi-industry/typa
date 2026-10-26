import { describe, expect, it, vi } from "vitest";
import { masterRepository, output, profile } from "../../test/fixtures";
import { PrivilegedSheetOperationInteractor } from "./PrivilegedSheetOperationInteractor";

const request = {
	sheetId: 100,
	expectedStatus: "finalized",
	action: "changeStatus",
	status: "draft",
	reason: "本番環境での再現テスト",
} as const;
const setup = (role = "Admin") => {
	const master = masterRepository();
	master.findCurrentEmployeeProfile.mockResolvedValue(profile(role));
	const repository = { execute: vi.fn().mockResolvedValue(undefined) };
	const usecase = new PrivilegedSheetOperationInteractor(repository, master);
	return { master, repository, usecase, out: output<{ message: string }>() };
};

describe("privileged sheet operations", () => {
	it.each(["Employee", "Reviewer"])("denies %s before any mutation", async (role) => {
		const { usecase, repository, out } = setup(role);
		expect(await usecase.execute(request, out)).toMatchObject({
			ok: false,
			error: { kind: "forbidden" },
		});
		expect(repository.execute).not.toHaveBeenCalled();
		expect(out.present).not.toHaveBeenCalled();
	});
	it("denies an unlinked account", async () => {
		const { usecase, master, repository, out } = setup();
		master.findCurrentEmployeeProfile.mockResolvedValue(null);
		expect((await usecase.execute(request, out)).ok).toBe(false);
		expect(repository.execute).not.toHaveBeenCalled();
	});
	it.each([
		{ sheetId: 0 },
		{ sheetId: 1.5 },
		{ expectedStatus: "unknown" },
		{ action: "unknown" },
		{ status: "unknown" },
		{ status: "finalized" },
		{ reason: "   " },
		{ reason: "理".repeat(501) },
		{ action: "delete", status: "draft" },
	])("rejects invalid input before writing: %j", async (change) => {
		const { usecase, repository, out } = setup();
		expect((await usecase.execute({ ...request, ...change }, out)).ok).toBe(false);
		expect(repository.execute).not.toHaveBeenCalled();
	});
	it.each([request, { ...request, action: "delete", status: undefined }])(
		"passes the validated operation and reason to the repository",
		async (input) => {
			const { usecase, repository, out } = setup();
			expect(await usecase.execute({ ...input, reason: ` ${input.reason} ` }, out)).toEqual({
				ok: true,
				value: undefined,
			});
			expect(repository.execute).toHaveBeenCalledWith(
				expect.objectContaining({
					sheetId: 100,
					expectedStatus: "finalized",
					action: input.action,
					reason: "本番環境での再現テスト",
				}),
			);
			expect(out.present).toHaveBeenCalled();
		},
	);
	it("propagates a server failure without announcing success", async () => {
		const { usecase, repository, out } = setup();
		repository.execute.mockRejectedValue(new Error("audit failed"));
		await expect(usecase.execute(request, out)).rejects.toThrow("audit failed");
		expect(out.present).not.toHaveBeenCalled();
	});
});
