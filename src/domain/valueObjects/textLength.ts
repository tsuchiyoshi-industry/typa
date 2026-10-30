/** 文字数。DB の char_length と同じくコードポイントで数える(絵文字も1文字)。 */
export const charLength = (text: string): number => [...text].length;
