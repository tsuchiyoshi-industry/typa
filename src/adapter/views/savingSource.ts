import { type Accessor, createSignal, onSettled } from "solid-js";

/** 子が「保存中か」を表す accessor を親に渡す口。消えるときは undefined を渡す。 */
export type ConnectSaving = (saving: Accessor<boolean> | undefined) => void;

/**
 * 子の「保存中か」を、子が作った accessor のまま受け取る(親の側)。
 * 値を effect で親の信号へ中継すると、中継するたびに 1 フレーム遅れ、そのぶん描き直しが増える
 * (Solid の診断 EFFECT_RELAY_TEAR)。accessor を一度だけ受け取り、親はそれを直接読む。
 */
export function createSavingSource(): { saving: Accessor<boolean>; connect: ConnectSaving } {
	const [source, setSource] = createSignal<Accessor<boolean> | undefined>(undefined);
	return {
		saving: () => source()?.() ?? false,
		// 関数をそのまま渡すと更新関数として扱われるので、包んで値として書く
		connect: (saving) => setSource(() => saving),
	};
}

/** 子の側。描き終えたら親に accessor を渡し、消えるときに外す。 */
export function provideSaving(
	connect: () => ConnectSaving | undefined,
	saving: Accessor<boolean>,
): void {
	onSettled(() => {
		const to = connect();
		to?.(saving);
		return () => to?.(undefined);
	});
}
