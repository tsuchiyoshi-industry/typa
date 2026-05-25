use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
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
    self_score: Option<i32>,
    evaluator_score: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommonEvaluationData {
    item_name: String,
    item_description: String,
    weight: i32,
    self_score: Option<i32>,
    evaluator_score: Option<i32>,
    self_comment: Option<String>,
    evaluator_comment: Option<String>,
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
    status: String,
    total_score: i32,
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
    dict.insert("status".into(), Value::Str(data.status.clone().into()));
    dict.insert("total_score".into(), Value::Int(data.total_score as i64));
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
                "self_score".into(),
                obj.self_score
                    .map_or(Value::Str("未評価".into()), |s| Value::Int(s as i64)),
            );
            obj_dict.insert(
                "evaluator_score".into(),
                obj.evaluator_score
                    .map_or(Value::Str("未評価".into()), |s| Value::Int(s as i64)),
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
                "self_score".into(),
                item.self_score
                    .map_or(Value::Str("未評価".into()), |s| Value::Int(s as i64)),
            );
            item_dict.insert(
                "evaluator_score".into(),
                item.evaluator_score
                    .map_or(Value::Str("未評価".into()), |s| Value::Int(s as i64)),
            );
            item_dict.insert(
                "self_comment".into(),
                Value::Str(item.self_comment.as_deref().unwrap_or("なし").into()),
            );
            item_dict.insert(
                "evaluator_comment".into(),
                Value::Str(item.evaluator_comment.as_deref().unwrap_or("なし").into()),
            );
            Value::Dict(item_dict)
        })
        .collect();
    dict.insert("common_evaluations".into(), Value::Array(common_eval_array));

    dict
}

// TypstでPDFを生成するTauriコマンド
#[tauri::command]
async fn generate_pdf_with_typst(
    data: SheetExportData,
    output_path: String,
) -> Result<String, String> {
    eprintln!("Starting PDF generation for: {}", data.employee_name);

    let pdf_file_path = std::path::PathBuf::from(&output_path);

    // 親ディレクトリが存在するか確認（念のため）
    if let Some(parent) = pdf_file_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // Typstコンパイルを実行
    compile_typst_to_pdf(&data, &pdf_file_path)?;

    Ok(output_path)
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
        .with_file_system_resolver("./templates")
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

    eprintln!("Writing PDF to file: {:?}", pdf_path);

    fs::write(pdf_path, pdf_data).map_err(|e| {
        let err_msg = format!("Failed to write PDF file: {}", e);
        eprintln!("{}", err_msg);
        err_msg
    })?;

    eprintln!("PDF file written successfully");

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_upload::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![generate_pdf_with_typst])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
