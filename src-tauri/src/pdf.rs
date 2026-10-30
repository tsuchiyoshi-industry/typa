//! 評価シートのPDF出力。PDF の中身は typa-pdf(ブラウザ版と共通)が作り、ここは保存ダイアログで選ばれた場所に書く。

use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri_plugin_fs::FsExt;
use typa_pdf::{SheetExportData, SheetOverviewData};

/// 1人分の評価シートをPDFにする。
#[tauri::command]
pub(crate) async fn generate_pdf_with_typst<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    data: SheetExportData,
    output_path: String,
) -> Result<String, String> {
    let path = PathBuf::from(&output_path);
    validate_destination(&path, &app.fs_scope(), "pdf")?;
    run_blocking(move || write_pdf(&path, typa_pdf::sheet_pdf(&data)?)).await?;
    Ok(output_path)
}

/// 全社の評価シート一覧をPDFにする。
#[tauri::command]
pub(crate) async fn generate_sheet_overview_pdf<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    data: SheetOverviewData,
    output_path: String,
) -> Result<String, String> {
    let path = PathBuf::from(&output_path);
    validate_destination(&path, &app.fs_scope(), "pdf")?;
    run_blocking(move || write_pdf(&path, typa_pdf::overview_pdf(&data)?)).await?;
    Ok(output_path)
}

fn write_pdf(path: &Path, pdf: Vec<u8>) -> Result<(), String> {
    fs::write(path, pdf).map_err(|e| format!("Failed to write PDF file: {}", e))
}

// Typstコンパイルは重い計算なので、非同期ランタイムのスレッドを塞がずに実行する
async fn run_blocking(
    task: impl FnOnce() -> Result<(), String> + Send + 'static,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| format!("PDF generation task failed: {}", e))?
}

/// 保存ダイアログで選ばれた、拡張子 extension の絶対パスだけを書き込み先として認める。
pub(crate) fn validate_destination(
    path: &Path,
    scope: &tauri::fs::Scope,
    extension: &str,
) -> Result<(), String> {
    if !path.is_absolute()
        || !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case(extension))
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(format!(
            "保存先は絶対パスの{}ファイルを指定してください。",
            extension.to_uppercase()
        ));
    }
    if !scope.is_allowed(path) {
        return Err("保存ダイアログで選択されていない保存先です。".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .invoke_handler(tauri::generate_handler![generate_sheet_overview_pdf])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap()
    }

    #[test]
    fn pdf_destination_requires_absolute_pdf_and_dialog_scope() {
        let app = mock_app();
        let scope = app.fs_scope();
        assert!(validate_destination(Path::new("sheet.pdf"), &scope, "pdf").is_err());
        let path = std::env::temp_dir().join("typa-test-only.pdf");
        assert!(validate_destination(&path, &scope, "pdf").is_err());
        scope.allow_file(&path).unwrap();
        assert!(validate_destination(&path, &scope, "pdf").is_ok());
        assert!(validate_destination(&path, &scope, "csv").is_err());
        let other = path.with_extension("exe");
        scope.allow_file(&other).unwrap();
        assert!(validate_destination(&other, &scope, "pdf").is_err());
        assert!(
            validate_destination(
                &std::env::temp_dir().join("child/../sheet.pdf"),
                &scope,
                "pdf"
            )
            .is_err()
        );
    }

    #[test]
    fn ipc_rejects_unselected_path_without_creating_a_file() {
        let app = mock_app();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let path = std::env::temp_dir().join(format!("typa-denied-{}.pdf", std::process::id()));
        let response = tauri::test::get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: "generate_sheet_overview_pdf".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(serde_json::json!({
                    "data": {"periodName": "26期", "periodStart": "", "periodEnd": "",
                             "issuedAt": "", "issuedBy": "", "rows": []},
                    "outputPath": path
                })),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        );
        assert_eq!(
            response.err().unwrap(),
            serde_json::json!("保存ダイアログで選択されていない保存先です。")
        );
        assert!(!path.exists());
    }
}
