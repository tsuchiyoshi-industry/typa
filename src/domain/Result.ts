/**
 * 失敗し得る処理の結果。業務のきまりに反する入力は例外にせず、どう失敗したかを E の型で返す。
 * E は集約ごとの判別可能なユニオン({ kind: ... })で、呼ぶ側は kind で分岐する。
 */
export type Result<T, E> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * 保存済みの値など、きまりどおりのはずのデータから作った結果を取り出す。
 * 失敗していたらデータの不整合(業務の失敗ではない)なので、例外にする。
 */
export function expectOk<T, E>(result: Result<T, E>, describe: (error: E) => string): T {
	if (!result.ok) {
		throw new Error(describe(result.error));
	}
	return result.value;
}
