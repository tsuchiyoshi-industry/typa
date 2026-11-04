import { fc } from "@fast-check/vitest";

/**
 * プロパティベーステストで使う値の作り方。
 * 文字数は DB の char_length と同じくコードポイントで数えるので、絵文字や 𠮷 のような
 * 2 単位(サロゲートペア)の文字を必ず混ぜる。
 */

/** 空白でない 1 文字(1 コードポイント)。サロゲートペアの文字を多めに混ぜる。 */
export const visibleChar = fc.oneof(
	fc.constantFrom("あ", "期", "😀", "𠮷", "a", "<", '"', ","),
	fc.string({ unit: "binary", minLength: 1, maxLength: 1 }).filter((char) => char.trim() === char),
);

/** ちょうど length 文字(コードポイント)で、前後に空白のない文字列。 */
export const textOfLength = (length: number) =>
	fc.array(visibleChar, { minLength: length, maxLength: length }).map((chars) => chars.join(""));

/** min〜max 文字の、前後に空白のない文字列。 */
export const textBetween = (min: number, max: number) =>
	fc.integer({ min, max }).chain(textOfLength);

/** String.prototype.trim が除く空白(全角空白・改行を含む)だけの文字列。空のこともある。 */
export const blank = fc
	.array(fc.constantFrom(" ", "　", "\n", "\r", "\t"), { maxLength: 6 })
	.map((spaces) => spaces.join(""));

/** 実在する日付(1900-01-01〜9999-12-31)の YYYY-MM-DD。 */
export const calendarDateText = fc
	.date({
		min: new Date(Date.UTC(1900, 0, 1)),
		max: new Date(Date.UTC(9999, 11, 31)),
		noInvalidDate: true,
	})
	.map((date) => date.toISOString().slice(0, 10));
