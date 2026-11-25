import { configure } from "@solidjs/testing-library";
import { flush } from "solid-js";

// テストと DOM ベンチマークでは、イベントで起きた更新までをその場で反映する。
configure({
	eventWrapper: (dispatch) => {
		const result = dispatch();
		flush();
		return result;
	},
});
