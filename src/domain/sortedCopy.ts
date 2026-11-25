/** 呼び出し元の配列を保つ。Firefox 114 など、toSorted のない実行環境にも対応する。 */
export function sortedCopy<T>(items: readonly T[], compare: (a: T, b: T) => number): T[] {
	return items.toSorted ? items.toSorted(compare) : items.slice().sort(compare);
}
