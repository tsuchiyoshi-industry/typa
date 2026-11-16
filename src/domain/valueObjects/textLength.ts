/** 文字数。DB の char_length と同じくコードポイントで数える(絵文字も1文字)。 */
// biome-ignore lint/nursery/noMisusedSpread: 見た目の文字(書記素)ではなく、DB の char_length と同じコードポイントで数えるのが目的
export const charLength = (text: string): number => [...text].length;
