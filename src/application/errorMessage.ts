/** 例外の本文。Error でなければ fallback(画面に出す既定の文言)にする。 */
export const messageOf = (error: unknown, fallback: string): string =>
	error instanceof Error ? error.message : fallback;
