import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authRequest } from "../../e2e/authRequest";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("waits for Auth capacity after 429, then returns the real response", async () => {
	const response = { status: 200, token: "synthetic-token" };
	const request = vi.fn().mockResolvedValueOnce({ status: 429 }).mockResolvedValueOnce(response);
	const result = authRequest(request);
	await vi.advanceTimersByTimeAsync(2_099);
	expect(request).toHaveBeenCalledTimes(1);
	await vi.advanceTimersByTimeAsync(1);
	expect(await result).toBe(response);
	expect(request).toHaveBeenCalledTimes(2);
});

it.each([200, 400, 401, 403, 500])("does not retry or hide HTTP %i", async (status) => {
	const response = { status };
	const request = vi.fn().mockResolvedValue(response);
	expect(await authRequest(request)).toBe(response);
	expect(request).toHaveBeenCalledTimes(1);
	expect(vi.getTimerCount()).toBe(0);
});

it("fails within a bounded time if Auth keeps returning 429", async () => {
	const request = vi.fn().mockResolvedValue({ status: 429 });
	const result = expect(authRequest(request)).rejects.toThrow("HTTP 429");
	await vi.runAllTimersAsync();
	await result;
	expect(request).toHaveBeenCalledTimes(6);
	expect(vi.getTimerCount()).toBe(0);
});

it("does not retry or hide a transport failure", async () => {
	const failure = new Error("synthetic network failure");
	const request = vi.fn().mockRejectedValue(failure);
	await expect(authRequest(request)).rejects.toBe(failure);
	expect(request).toHaveBeenCalledTimes(1);
});
