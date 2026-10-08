use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_fs::FsExt;
use typst::foundations::{Array, Dict, Value};

// テンプレートファイルを埋め込み
static TEMPLATE_FILE: &str = include_str!("./templates/template.typ");
static FONT: &[u8] = include_bytes!("./templates/ZenAntiqueSoft-Regular.ttf");

// 評価シートデータ構造
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObjectiveData {
    id: i32,
    goal_number: i32,
    challenge_goal: String,
    midterm_goal: String,
    achievement: String,
    // 一次評価の点数。
    first_score: Option<i32>,
    // 二次評価の点数。二次評価者「なし」の社員は "未評価"。
    second_score: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommonEvaluationData {
    item_name: String,
    item_description: String,
    weight: i32,
    // 一次評価の点数と、一次評価者のコメント。
    first_score: Option<i32>,
    // 二次評価の点数。二次評価者「なし」の社員は "未評価"。
    second_score: String,
    first_comment: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SheetExportData {
    sheet_id: i32,
    employee_name: String,
    employee_no: String,
    career_course: String,
    grade_name: String,
    period_name: String,
    period_start: String,
    period_end: String,
    primary_evaluator: String,
    secondary_evaluator: String,
    // true の場合(二次評価者「なし」)は一次評価者が最終評価者を兼ね、一次評価がそのまま最終評価になる。
    primary_is_final_evaluator: bool,
    status: String,
    final_evaluation_rank: String,
    objective_allocation_score: i32,
    // 最終評価(二次評価。二次評価者「なし」の社員は一次評価)の獲得率と評価点。
    // 採点はTypeScript側で済ませており、表示用の文字列で受け取る。
    objective_second_rate: String,
    objective_evaluation_score: String,
    common_evaluation_allocation_score: i32,
    common_evaluation_second_rate: String,
    common_evaluation_evaluation_score: String,
    total_evaluation_score: String,
    first_overall_comment: String,
    second_overall_comment: String,
    objectives: Vec<ObjectiveData>,
    common_evaluations: Vec<CommonEvaluationData>,
}

// データをTypstのDict形式に変換
fn convert_data_to_dict(data: &SheetExportData) -> Dict {
    let mut dict = Dict::new();

    // 基本情報
    dict.insert("sheet_id".into(), Value::Int(data.sheet_id as i64));
    dict.insert(
        "employee_name".into(),
        Value::Str(data.employee_name.clone().into()),
    );
    dict.insert(
        "employee_no".into(),
        Value::Str(data.employee_no.clone().into()),
    );
    dict.insert(
        "career_course".into(),
        Value::Str(data.career_course.clone().into()),
    );
    dict.insert(
        "grade_name".into(),
        Value::Str(data.grade_name.clone().into()),
    );
    dict.insert(
        "period_name".into(),
        Value::Str(data.period_name.clone().into()),
    );
    dict.insert(
        "period_start".into(),
        Value::Str(data.period_start.clone().into()),
    );
    dict.insert(
        "period_end".into(),
        Value::Str(data.period_end.clone().into()),
    );
    dict.insert(
        "primary_evaluator".into(),
        Value::Str(data.primary_evaluator.clone().into()),
    );
    dict.insert(
        "secondary_evaluator".into(),
        Value::Str(data.secondary_evaluator.clone().into()),
    );
    dict.insert(
        "primary_is_final_evaluator".into(),
        Value::Bool(data.primary_is_final_evaluator),
    );
    dict.insert("status".into(), Value::Str(data.status.clone().into()));
    dict.insert(
        "final_evaluation_rank".into(),
        Value::Str(data.final_evaluation_rank.clone().into()),
    );
    dict.insert(
        "objective_allocation_score".into(),
        Value::Int(data.objective_allocation_score as i64),
    );
    dict.insert(
        "objective_second_rate".into(),
        Value::Str(data.objective_second_rate.clone().into()),
    );
    dict.insert(
        "objective_evaluation_score".into(),
        Value::Str(data.objective_evaluation_score.clone().into()),
    );
    dict.insert(
        "common_evaluation_allocation_score".into(),
        Value::Int(data.common_evaluation_allocation_score as i64),
    );
    dict.insert(
        "common_evaluation_second_rate".into(),
        Value::Str(data.common_evaluation_second_rate.clone().into()),
    );
    dict.insert(
        "common_evaluation_evaluation_score".into(),
        Value::Str(data.common_evaluation_evaluation_score.clone().into()),
    );
    dict.insert(
        "total_evaluation_score".into(),
        Value::Str(data.total_evaluation_score.clone().into()),
    );
    dict.insert(
        "first_overall_comment".into(),
        Value::Str(data.first_overall_comment.clone().into()),
    );
    dict.insert(
        "second_overall_comment".into(),
        Value::Str(data.second_overall_comment.clone().into()),
    );

    // 目標データを配列に変換
    let objectives_array: Array = data
        .objectives
        .iter()
        .map(|obj| {
            let mut obj_dict = Dict::new();
            obj_dict.insert("goal_number".into(), Value::Int(obj.goal_number as i64));
            obj_dict.insert(
                "challenge_goal".into(),
                Value::Str(obj.challenge_goal.clone().into()),
            );
            obj_dict.insert(
                "midterm_goal".into(),
                Value::Str(obj.midterm_goal.clone().into()),
            );
            obj_dict.insert(
                "achievement".into(),
                Value::Str(obj.achievement.clone().into()),
            );
            obj_dict.insert(
                "first_score".into(),
                obj.first_score
                    .map_or(Value::Str("未評価".into()), |s| Value::Int(s as i64)),
            );
            obj_dict.insert(
                "second_score".into(),
                Value::Str(obj.second_score.clone().into()),
            );
            Value::Dict(obj_dict)
        })
        .collect();
    dict.insert("objectives".into(), Value::Array(objectives_array));

    // 共通評価データを配列に変換
    let common_eval_array: Array = data
        .common_evaluations
        .iter()
        .map(|item| {
            let mut item_dict = Dict::new();
            item_dict.insert(
                "item_name".into(),
                Value::Str(item.item_name.clone().into()),
            );
            item_dict.insert(
                "item_description".into(),
                Value::Str(item.item_description.clone().into()),
            );
            item_dict.insert("weight".into(), Value::Int(item.weight as i64));
            item_dict.insert(
                "first_score".into(),
                item.first_score
                    .map_or(Value::Str("未評価".into()), |s| Value::Int(s as i64)),
            );
            item_dict.insert(
                "second_score".into(),
                Value::Str(item.second_score.clone().into()),
            );
            item_dict.insert(
                "first_comment".into(),
                Value::Str(item.first_comment.as_deref().unwrap_or("なし").into()),
            );
            Value::Dict(item_dict)
        })
        .collect();
    dict.insert("common_evaluations".into(), Value::Array(common_eval_array));

    dict
}

// TypstでPDFを生成するTauriコマンド
#[tauri::command]
async fn generate_pdf_with_typst<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    data: SheetExportData,
    output_path: String,
) -> Result<String, String> {
    let pdf_file_path = std::path::PathBuf::from(&output_path);
    validate_pdf_destination(&pdf_file_path, &app.fs_scope())?;

    // Typstコンパイルを実行
    compile_typst_to_pdf(&data, &pdf_file_path)?;

    Ok(output_path)
}

fn validate_pdf_destination(
    path: &std::path::Path,
    scope: &tauri::fs::Scope,
) -> Result<(), String> {
    if !path.is_absolute()
        || !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
        || path
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err("保存先は絶対パスのPDFファイルを指定してください。".into());
    }
    if !scope.is_allowed(path) {
        return Err("保存ダイアログで選択されていない保存先です。".into());
    }
    Ok(())
}

fn compile_typst_to_pdf(data: &SheetExportData, pdf_path: &PathBuf) -> Result<(), String> {
    use typst_as_lib::TypstEngine;
    // 注: Dict, Value の import は convert_data_to_dict 内で使っていればここからは消してもOKです

    eprintln!("Converting data to dict...");

    // 1. 実際のデータが入った辞書を作成
    // この data_content 自体が Typst の「sys.inputs」になります
    let data_content = convert_data_to_dict(data);

    eprintln!("Building Typst engine...");

    let template = TypstEngine::builder()
        .main_file(TEMPLATE_FILE)
        .fonts([FONT])
        .build();

    eprintln!("Compiling Typst template...");

    // 2. ラップせず、data_content をそのまま渡す！
    // これにより、Typst 側で #import sys: inputs すると、
    // inputs がそのまま data_content (employee_name等が入った辞書) になります
    let result = template.compile_with_input(data_content);

    eprintln!("Compilation result warnings: {:?}", result.warnings);

    let doc = result.output.map_err(|e| {
        let err_msg = format!("Typst compilation failed: {:?}", e);
        eprintln!("{}", err_msg);
        err_msg
    })?;

    eprintln!("Generating PDF...");

    let pdf_options = typst_pdf::PdfOptions::default();
    let pdf_data = typst_pdf::pdf(&doc, &pdf_options).map_err(|e| {
        let err_msg = format!("PDF generation failed: {:?}", e);
        eprintln!("{}", err_msg);
        err_msg
    })?;

    fs::write(pdf_path, pdf_data).map_err(|e| {
        let err_msg = format!("Failed to write PDF file: {}", e);
        eprintln!("{}", err_msg);
        err_msg
    })?;

    eprintln!("PDF file written successfully");

    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendEmailRequest {
    smtp_host: String,
    smtp_port: u16,
    smtp_user: String,
    smtp_password: String,
    to: String,
    subject: String,
    body: String,
}

// SMTP経由でメールを送信するTauriコマンド
#[tauri::command]
async fn send_email(request: SendEmailRequest) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        use lettre::message::Message;
        use lettre::transport::smtp::authentication::Credentials;
        use lettre::{SmtpTransport, Transport};

        let email = Message::builder()
            .from(
                request
                    .smtp_user
                    .parse()
                    .map_err(|e| format!("送信元メールアドレスが不正です: {}", e))?,
            )
            .to(request
                .to
                .parse()
                .map_err(|e| format!("宛先メールアドレスが不正です: {}", e))?)
            .subject(request.subject)
            .body(request.body)
            .map_err(|e| format!("メール本文の生成に失敗しました: {}", e))?;

        let credentials = Credentials::new(request.smtp_user, request.smtp_password);

        let mailer = SmtpTransport::starttls_relay(&request.smtp_host)
            .map_err(|e| format!("SMTPサーバーへの接続設定に失敗しました: {}", e))?
            .port(request.smtp_port)
            .credentials(credentials)
            .build();

        mailer
            .send(&email)
            .map_err(|e| format!("メール送信に失敗しました: {}", e))?;

        Ok(())
    })
    .await
    .map_err(|e| format!("メール送信タスクの実行に失敗しました: {}", e))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // どのバージョンが動いているかを、ウィンドウのタイトルで確かめられるようにする
            if let Some(window) = app.get_webview_window("main") {
                window.set_title(&format!("typa v{}", app.package_info().version))?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            generate_pdf_with_typst,
            send_email
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_data() -> SheetExportData {
        test_data_with_final_evaluator(false)
    }

    fn test_data_with_final_evaluator(primary_is_final_evaluator: bool) -> SheetExportData {
        serde_json::from_value(serde_json::json!({
            "primaryIsFinalEvaluator": primary_is_final_evaluator,
            "sheetId": 100, "employeeName": "#read(\"secret.txt\")", "employeeNo": "TEST001",
            "careerCourse": "技術", "gradeName": "等級", "periodName": "テスト期間",
            "periodStart": "2026-04-01", "periodEnd": "2026-09-30",
            "primaryEvaluator": "一次", "secondaryEvaluator": "二次", "status": "submitted",
            "totalScore": 0, "finalEvaluationRank": "*", "objectiveAllocationScore": 20,
            "objectiveSecondRate": "*", "objectiveEvaluationScore": "*",
            "commonEvaluationAllocationScore": 80, "commonEvaluationSecondRate": "*",
            "commonEvaluationEvaluationScore": "*", "totalEvaluationScore": "*",
            "firstOverallComment": "#include \"secret.txt\"", "secondOverallComment": "*",
            "objectives": [{"id": 11, "goalNumber": 1, "challengeGoal": "[malicious] #eval(\"1\")",
                "midtermGoal": "中間", "achievement": "達成", "firstScore": null, "secondScore": "*"}],
            "commonEvaluations": [{"itemName": "共通", "itemDescription": "説明", "weight": 5,
                "firstScore": 3, "secondScore": "*", "firstComment": null}]
        })).unwrap()
    }

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
        assert!(validate_pdf_destination(std::path::Path::new("sheet.pdf"), &scope).is_err());
        let path = std::env::temp_dir().join("typa-test-only.pdf");
        assert!(validate_pdf_destination(&path, &scope).is_err());
        scope.allow_file(&path).unwrap();
        assert!(validate_pdf_destination(&path, &scope).is_ok());
        let other = path.with_extension("exe");
        scope.allow_file(&other).unwrap();
        assert!(validate_pdf_destination(&other, &scope).is_err());
        assert!(
            validate_pdf_destination(&std::env::temp_dir().join("child/../sheet.pdf"), &scope)
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
                    serde_json::json!({"data": test_data(), "outputPath": path}),
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

    #[test]
    fn typst_input_remains_literal_data() {
        let data = test_data();
        let dict = convert_data_to_dict(&data);
        assert_eq!(
            dict.get("employee_name").unwrap(),
            &Value::Str(data.employee_name.into())
        );
        assert_eq!(
            dict.get("second_overall_comment").unwrap(),
            &Value::Str("*".into())
        );
    }

    #[test]
    fn pdf_compiles_with_masked_values_and_literal_markup() {
        let directory = std::env::temp_dir().join(format!("typa-pdf-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("sheet.pdf");
        // 最終評価者が二次評価者の場合・一次評価者の場合の両方でテンプレートがコンパイルできること
        let results: Vec<_> = [false, true]
            .into_iter()
            .map(|primary_is_final_evaluator| {
                let result = compile_typst_to_pdf(
                    &test_data_with_final_evaluator(primary_is_final_evaluator),
                    &path,
                );
                let header = result.as_ref().ok().map(|_| fs::read(&path).unwrap());
                if path.exists() {
                    fs::remove_file(&path).unwrap();
                }
                (result, header)
            })
            .collect();
        fs::remove_dir(&directory).unwrap();
        for (result, header) in results {
            result.unwrap();
            assert!(header.unwrap().starts_with(b"%PDF-"));
        }
    }
}
