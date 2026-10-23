//! 評価シートのPDF出力。Typst のテンプレートにデータを流し込み、保存ダイアログで選ばれた場所に書く。

mod overview;
mod sheet;

use overview::SheetOverviewData;
use sheet::SheetExportData;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::LazyLock;
use tauri_plugin_fs::FsExt;
use typst::foundations::{Dict, Value};
use typst_as_lib::TypstEngine;

static FONT: &[u8] = include_bytes!("pdf/templates/ZenAntiqueSoft-Regular.ttf");

// フォント(7MB)の解析と標準ライブラリの構築は重いので、エンジンは1つを使い回す。
// 直近10回分のコンパイル結果も残し、続けて出力するときはレイアウト等を再利用する。
static ENGINE: LazyLock<TypstEngine> = LazyLock::new(|| {
    TypstEngine::builder()
        .with_static_source_file_resolver([
            (sheet::TEMPLATE, sheet::SOURCE),
            (overview::TEMPLATE, overview::SOURCE),
        ])
        .fonts([FONT])
        .comemo_evict_max_age(Some(10))
        .build()
});

/// 1人分の評価シートをPDFにする。
#[tauri::command]
pub(crate) async fn generate_pdf_with_typst<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    data: SheetExportData,
    output_path: String,
) -> Result<String, String> {
    let path = PathBuf::from(&output_path);
    validate_destination(&path, &app.fs_scope(), "pdf")?;
    run_blocking(move || compile_template(sheet::TEMPLATE, sheet::to_dict(&data), &path)).await?;
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
    run_blocking(move || compile_template(overview::TEMPLATE, overview::to_dict(&data), &path))
        .await?;
    Ok(output_path)
}

fn str_dict(pairs: &[(&str, &str)]) -> Dict {
    let mut dict = Dict::new();
    for (key, value) in pairs {
        dict.insert((*key).into(), Value::Str((*value).into()));
    }
    dict
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

// inputs はラップせずに渡すので、テンプレート側では sys.inputs がこの辞書そのものになる
fn compile_template(template_file: &str, inputs: Dict, pdf_path: &Path) -> Result<(), String> {
    let result = ENGINE.compile_with_input(template_file, inputs);
    if !result.warnings.is_empty() {
        eprintln!("Typst warnings: {:?}", result.warnings);
    }
    let doc = result
        .output
        .map_err(|e| format!("Typst compilation failed: {:?}", e))?;
    let pdf = typst_pdf::pdf(&doc, &typst_pdf::PdfOptions::default())
        .map_err(|e| format!("PDF generation failed: {:?}", e))?;
    fs::write(pdf_path, pdf).map_err(|e| format!("Failed to write PDF file: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .invoke_handler(tauri::generate_handler![generate_pdf_with_typst])
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
                cmd: "generate_pdf_with_typst".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(
                    serde_json::json!({"data": sheet::tests::test_data(false), "outputPath": path}),
                ),
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
