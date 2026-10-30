// 画面を描く前にテーマを当て、ちらつきを防ぐ(CSP でインラインのスクリプトは使えないので別ファイル)
(() => {
	try {
		const stored = localStorage.getItem("typa:theme");
		if (stored === "light" || stored === "dark") {
			document.documentElement.setAttribute("data-theme", stored);
		}
	} catch {}
})();
