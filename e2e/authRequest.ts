/**
 * UI sign-ins and REST assertions share one IP and GoTrue's 30-request burst.
 * Keep the real limiter enabled; wait for capacity only when it returns 429.
 * At the local default (150 tokens / 5 min), one token returns every 2 seconds.
 */
export async function authRequest<T extends { status: number }>(
	request: () => Promise<T>,
): Promise<T> {
	for (let retry = 0; ; retry++) {
		const response = await request();
		if (response.status !== 429) {
			return response;
		}
		if (retry === 5) {
			throw new Error("E2E Auth is still rate limited (HTTP 429) after 5 retries.");
		}
		await new Promise((resolve) => setTimeout(resolve, 2_100));
	}
}
