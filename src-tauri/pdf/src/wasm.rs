//! ブラウザ(WASM)からの呼び出し口。wasm-bindgen を使わず、メモリの受け渡しだけで済ませる。
//!
//! 1. JS が `alloc(len)` で領域をもらい、JSON(UTF-8)を書き込む
//! 2. `render(kind, ptr, len)` を呼ぶ(入力の領域はここで解放する)。kind は 0 = 評価シート、1 = 全社一覧
//! 3. 戻り値の位置から [状態 1 バイト(0 = 成功、1 = 失敗)][長さ u32 LE][PDF かエラー文] を読む
//! 4. `dealloc(ptr, 5 + 長さ)` で結果の領域を返す

use crate::{SheetExportData, SheetOverviewData, overview_pdf, sheet_pdf};

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()).cast()
}

/// # Safety
/// `ptr` と `len` は `alloc` か `render` が返した領域と、その長さそのもの。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)) });
}

/// # Safety
/// `ptr` と `len` は `alloc` が返した領域と、その長さそのもの。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn render(kind: u32, ptr: *mut u8, len: usize) -> *mut u8 {
    let input = unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)) };
    match render_json(kind, &input) {
        Ok(pdf) => pack(0, &pdf),
        Err(message) => pack(1, message.as_bytes()),
    }
}

fn render_json(kind: u32, json: &[u8]) -> Result<Vec<u8>, String> {
    let invalid = |e: serde_json::Error| format!("PDFのデータが正しくありません: {e}");
    match kind {
        0 => sheet_pdf(&serde_json::from_slice::<SheetExportData>(json).map_err(invalid)?),
        1 => overview_pdf(&serde_json::from_slice::<SheetOverviewData>(json).map_err(invalid)?),
        _ => Err(format!("PDFの種類が正しくありません: {kind}")),
    }
}

fn pack(status: u8, body: &[u8]) -> *mut u8 {
    let mut out = Vec::with_capacity(5 + body.len());
    out.push(status);
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(body);
    Box::into_raw(out.into_boxed_slice()).cast()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ネイティブでも同じ受け渡しをたどって、JS 側が読む形を確かめる
    fn call(kind: u32, json: &str) -> (u8, Vec<u8>) {
        let ptr = alloc(json.len());
        unsafe { std::ptr::copy_nonoverlapping(json.as_ptr(), ptr, json.len()) };
        let out = unsafe { render(kind, ptr, json.len()) };
        let header = unsafe { std::slice::from_raw_parts(out, 5) };
        let (status, len) = (
            header[0],
            u32::from_le_bytes(header[1..5].try_into().unwrap()),
        );
        let body = unsafe { std::slice::from_raw_parts(out.add(5), len as usize) }.to_vec();
        unsafe { dealloc(out, 5 + len as usize) };
        (status, body)
    }

    #[test]
    fn returns_a_pdf_or_a_readable_error() {
        let overview = r#"{"periodName":"26期","periodStart":"","periodEnd":"","issuedAt":"","issuedBy":"","rows":[]}"#;
        let (status, body) = call(1, overview);
        assert_eq!(status, 0);
        assert!(body.starts_with(b"%PDF-"));

        let (status, body) = call(1, r#"{"periodName":"26期"}"#);
        assert_eq!(status, 1);
        assert!(
            String::from_utf8(body)
                .unwrap()
                .starts_with("PDFのデータが正しくありません")
        );

        let (status, body) = call(0, "not json");
        assert_eq!(status, 1);
        assert!(
            String::from_utf8(body)
                .unwrap()
                .starts_with("PDFのデータが正しくありません")
        );

        let (status, body) = call(9, overview);
        assert_eq!(status, 1);
        assert_eq!(
            String::from_utf8(body).unwrap(),
            "PDFの種類が正しくありません: 9"
        );
    }
}
