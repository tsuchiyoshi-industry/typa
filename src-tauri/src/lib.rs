mod pdf;

use tauri::Manager;
use tauri::webview::PermissionResponse;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 2つ目を起動したら、すでに開いているウィンドウを前に出す。
        // 共有PCで二重に開いて、どちらでログインしたか分からなくなるのを防ぐ(他のプラグインより先に登録する)
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        // カメラ・マイク・位置情報・通知などは使わないので、Webview からの要求はすべて断る。
        // (クリップボードへの書き込みは要求なしで使える)
        .on_permission_request(|_, _| PermissionResponse::Deny)
        .setup(|app| {
            // どのバージョンが動いているかを、ウィンドウのタイトルで確かめられるようにする
            if let Some(window) = app.get_webview_window("main") {
                window.set_title(&format!("typa v{}", app.package_info().version))?;
            }
            Ok(())
        })
        // 通知メールはサーバー側(Edge Function)が送る。アプリは SMTP の認証情報を扱わない
        .invoke_handler(tauri::generate_handler![
            pdf::generate_pdf_with_typst,
            pdf::generate_sheet_overview_pdf
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
