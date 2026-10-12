import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// 共有PCで前の人のログインが残らないよう、セッションはアプリを閉じると消える場所に置く
export const supabase = createClient(supabaseUrl, supabaseKey, {
	auth: { storage: globalThis.sessionStorage },
});
