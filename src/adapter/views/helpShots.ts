// ヘルプの画面写真は、CI がマニュアルと一緒に撮る(git には置かない)。
// 撮っていない手元のビルドやテストでも動くよう、あれば使い、無ければ写真を出さない。
const SHOTS = import.meta.glob<string>("../../../docs/manual/{user,evaluator}/*.png", {
	eager: true,
	import: "default",
});

/** "user/07-goal" のようなマニュアルの画面写真の URL。撮っていなければ undefined。 */
export const helpShot = (name: string): string | undefined =>
	SHOTS[`../../../docs/manual/${name}.png`];
