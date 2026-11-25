import { createSignal, flush, type Signal } from "solid-js";

/**
 * テストが外から書き換える値。Solid 2 は書き込みを次のマイクロタスクでまとめて反映するので、
 * 書いたらすぐ反映し、その場で画面を読めるようにする(イベントは setupSolid.ts が同じことをする)。
 */
export function testSignal<T>(initial: T): Signal<T> {
	// 値の形で作る(関数を渡すと派生の値になる)。テストの値は関数ではない
	const [read, write] = createSignal<T>(initial as never);
	const writeNow = ((next: Parameters<typeof write>[0]) => {
		const value = write(next);
		flush();
		return value;
	}) as typeof write;
	return [read, writeNow];
}
