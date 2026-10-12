import { expect, it } from "vitest";
import { createSessionStore } from "./sessionStore";

const KEY = "sb-test-auth-token";
function memory(initial: Record<string, string> = {}) {
	const data = new Map(Object.entries(initial));
	return {
		data,
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value),
		removeItem: (key: string) => void data.delete(key),
		key: (index: number) => [...data.keys()][index] ?? null,
		get length() {
			return data.size;
		},
	};
}

it("keeps the session only until the app is closed, unless told to keep it", () => {
	const session = memory();
	const local = memory({ theme: "dark" });
	const store = createSessionStore(session, local);
	store.storage.setItem(KEY, "token");
	expect(store.storage.getItem(KEY)).toBe("token");
	// アプリを閉じると sessionStorage は消える。localStorage には何も残していない
	expect([...local.data.keys()]).toEqual(["theme"]);
});

it("keeps an employee signed in across restarts once the employee master says so", () => {
	const local = memory();
	const first = createSessionStore(memory(), local);
	first.storage.setItem(KEY, "token");
	first.keepSignedIn(true);
	first.storage.setItem(KEY, "refreshed");

	// 次に開いたとき: sessionStorage は空で、localStorage に残したセッションで始まる
	const session = memory();
	const next = createSessionStore(session, local);
	expect(next.storage.getItem(KEY)).toBe("refreshed");
	// 設定を読み直す前にトークンが更新されても、残しているほうを古いままにしない
	next.storage.setItem(KEY, "refreshed again");
	expect(local.getItem(KEY)).toBe("refreshed again");
});

it("stops keeping the session when the setting is turned off, without ending the current run", () => {
	const local = memory({ [KEY]: "kept", theme: "dark" });
	const session = memory();
	const store = createSessionStore(session, local);
	store.keepSignedIn(false);
	expect(local.getItem(KEY)).toBeNull();
	expect(local.getItem("theme")).toBe("dark");
	expect(store.storage.getItem(KEY)).toBe("kept");
	store.storage.setItem(KEY, "refreshed");
	expect(local.getItem(KEY)).toBeNull();
});

it("removes the session from both places on sign-out", () => {
	const local = memory();
	const session = memory();
	const store = createSessionStore(session, local);
	store.storage.setItem(KEY, "token");
	store.keepSignedIn(true);
	store.storage.removeItem(KEY);
	expect([session.getItem(KEY), local.getItem(KEY)]).toEqual([null, null]);
});
