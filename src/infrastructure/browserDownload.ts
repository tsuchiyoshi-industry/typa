export type DownloadFile = (contents: BlobPart, type: string, fileName: string) => void;

/** ブラウザのダウンロードとして保存する(保存先はブラウザの設定に従う)。 */
export const downloadFile: DownloadFile = (contents, type, fileName) => {
	const url = URL.createObjectURL(new Blob([contents], { type }));
	const link = document.createElement("a");
	link.href = url;
	link.download = fileName;
	link.click();
	// クリックで始まったダウンロードが URL を読み終えてから手放す
	setTimeout(() => URL.revokeObjectURL(url), 0);
};
