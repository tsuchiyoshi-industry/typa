use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

// 評価シートデータ構造
#[derive(Debug, Serialize, Deserialize)]
struct ObjectiveData {
    id: i32,
    title: String,
    description: String,
    target_date: String,
    status: String,
    self_score: Option<i32>,
    evaluator_score: Option<i32>,
    self_comment: Option<String>,
    evaluator_comment: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CommonEvaluationData {
    item_name: String,
    self_score: Option<i32>,
    evaluator_score: Option<i32>,
    self_comment: Option<String>,
    evaluator_comment: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SheetExportData {
    sheet_id: i32,
    employee_name: String,
    employee_no: String,
    period_name: String,
    period_start: String,
    period_end: String,
    primary_evaluator: String,
    secondary_evaluator: String,
    status: String,
    total_score: i32,
    objectives: Vec<ObjectiveData>,
    common_evaluations: Vec<CommonEvaluationData>,
}

// Typstテンプレートを生成
fn create_typst_template(data: &SheetExportData) -> String {
    let mut objectives_content = String::new();
    for (idx, obj) in data.objectives.iter().enumerate() {
        let self_score = obj
            .self_score
            .map_or("未評価".to_string(), |s| s.to_string());
        let evaluator_score = obj
            .evaluator_score
            .map_or("未評価".to_string(), |s| s.to_string());
        let self_comment = obj.self_comment.as_deref().unwrap_or("なし");
        let evaluator_comment = obj.evaluator_comment.as_deref().unwrap_or("なし");

        objectives_content.push_str(&format!(
            r#"
== 目標 {}: {}

*説明:* {}

*目標日:* {}

*ステータス:* {}

*自己評価スコア:* {}

*評価者スコア:* {}

*自己コメント:* {}

*評価者コメント:* {}

"#,
            idx + 1,
            escape_typst(&obj.title),
            escape_typst(&obj.description),
            escape_typst(&obj.target_date),
            escape_typst(&obj.status),
            self_score,
            evaluator_score,
            escape_typst(self_comment),
            escape_typst(evaluator_comment)
        ));
    }

    let mut common_eval_content = String::new();
    for item in &data.common_evaluations {
        let self_score = item
            .self_score
            .map_or("未評価".to_string(), |s| s.to_string());
        let evaluator_score = item
            .evaluator_score
            .map_or("未評価".to_string(), |s| s.to_string());
        let self_comment = item.self_comment.as_deref().unwrap_or("なし");
        let evaluator_comment = item.evaluator_comment.as_deref().unwrap_or("なし");

        common_eval_content.push_str(&format!(
            r#"
== {}

*自己評価:* {}

*評価者評価:* {}

*自己コメント:* {}

*評価者コメント:* {}

"#,
            escape_typst(&item.item_name),
            self_score,
            evaluator_score,
            escape_typst(self_comment),
            escape_typst(evaluator_comment)
        ));
    }

    format!(
        r#"#set page(paper: "a4", margin: 2cm)
#set text(font: "Noto Sans CJK JP", size: 10pt, lang: "ja")
#set par(justify: true)

#align(center)[
  #text(size: 18pt, weight: "bold")[評価シート]
]

#v(1.5em)

#grid(
  columns: (1fr, 1fr),
  gutter: 1em,
  [*氏名:* {}],
  [*社員番号:* {}],
  [*評価期間:* {}],
  [*期間:* {} ～ {}],
  [*主評価者:* {}],
  [*副評価者:* {}],
  [*ステータス:* {}],
  [*総合スコア:* {}],
)

#v(1.5em)

= 目標・マイルストーン

{}

#pagebreak()

= 共通評価項目

{}
"#,
        escape_typst(&data.employee_name),
        escape_typst(&data.employee_no),
        escape_typst(&data.period_name),
        escape_typst(&data.period_start),
        escape_typst(&data.period_end),
        escape_typst(&data.primary_evaluator),
        escape_typst(&data.secondary_evaluator),
        escape_typst(&data.status),
        data.total_score,
        objectives_content,
        common_eval_content
    )
}

// Typstの特殊文字をエスケープ
fn escape_typst(s: &str) -> String {
    s.replace('\\', r"\\")
        .replace('[', r"\[")
        .replace(']', r"\]")
        .replace('#', r"\#")
        .replace('*', r"\*")
        .replace('_', r"\_")
}

// TypstでPDFを生成するTauriコマンド
#[tauri::command]
async fn generate_pdf_with_typst(
    app_handle: tauri::AppHandle,
    data: SheetExportData,
) -> Result<String, String> {
    // Typstテンプレートを生成
    let typst_content = create_typst_template(&data);

    // 一時ディレクトリにTypstファイルを保存
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {}", e))?;

    let typst_file_path = app_data_dir.join("temp_sheet.typ");
    let pdf_file_path = app_data_dir.join(format!(
        "評価シート_{}_{}.pdf",
        data.employee_name, data.period_name
    ));

    // Typstファイルを書き込み
    fs::write(&typst_file_path, typst_content)
        .map_err(|e| format!("Failed to write Typst file: {}", e))?;

    // Typstコンパイル
    let result = compile_typst_to_pdf(&typst_file_path, &pdf_file_path);

    // 一時Typstファイルを削除
    let _ = fs::remove_file(&typst_file_path);

    match result {
        Ok(_) => Ok(pdf_file_path.to_string_lossy().to_string()),
        Err(e) => Err(format!("Failed to compile Typst: {}", e)),
    }
}

// TypstをコンパイルしてPDFを生成
fn compile_typst_to_pdf(typst_path: &PathBuf, pdf_path: &PathBuf) -> Result<(), String> {
    use std::collections::HashMap;
    use typst::diag::{FileResult, Severity};
    use typst::foundations::{Bytes, Datetime};
    use typst::syntax::{FileId, Source, VirtualPath};
    use typst::text::{Font, FontBook};
    use typst::utils::LazyHash;
    use typst::{Library, World};

    // Typstワールドの実装
    struct SimpleWorld {
        library: LazyHash<Library>,
        book: LazyHash<FontBook>,
        fonts: Vec<Font>,
        main_id: FileId,
        sources: HashMap<FileId, Source>,
    }

    impl SimpleWorld {
        fn new(source_text: String) -> Self {
            // Typst 0.14.2の標準ライブラリを使用
            // Libraryを空で初期化（最小限の実装）
            let lib = unsafe { std::mem::zeroed::<Library>() };

            let library_hash = LazyHash::new(lib);
            let book = LazyHash::new(FontBook::new());
            let fonts = vec![];
            let main_id = FileId::new(None, VirtualPath::new("main.typ"));
            let source = Source::new(main_id, source_text);
            let mut sources = HashMap::new();
            sources.insert(main_id, source);

            Self {
                library: library_hash,
                book,
                fonts,
                main_id,
                sources,
            }
        }
    }

    impl World for SimpleWorld {
        fn library(&self) -> &LazyHash<Library> {
            &self.library
        }

        fn book(&self) -> &LazyHash<FontBook> {
            &self.book
        }

        fn main(&self) -> FileId {
            self.main_id
        }

        fn source(&self, id: FileId) -> FileResult<Source> {
            self.sources.get(&id).cloned().ok_or_else(|| {
                typst::diag::FileError::NotFound(id.vpath().as_rootless_path().into())
            })
        }

        fn file(&self, id: FileId) -> FileResult<Bytes> {
            Err(typst::diag::FileError::NotFound(
                id.vpath().as_rootless_path().into(),
            ))
        }

        fn font(&self, index: usize) -> Option<Font> {
            self.fonts.get(index).cloned()
        }

        fn today(&self, _offset: Option<i64>) -> Option<Datetime> {
            let now = time::OffsetDateTime::now_utc();
            Datetime::from_ymd(now.year(), now.month().into(), now.day())
        }
    }

    // Typstソースを読み込み
    let source_text =
        fs::read_to_string(typst_path).map_err(|e| format!("Failed to read Typst file: {}", e))?;

    // ワールドを作成
    let world = SimpleWorld::new(source_text);

    // コンパイル
    let result = typst::compile(&world);

    let document = match result.output {
        Ok(doc) => doc,
        Err(_) => {
            let errors: Vec<String> = result
                .warnings
                .iter()
                .filter(|w| w.severity == Severity::Error)
                .map(|w| format!("{:?}", w))
                .collect();
            return Err(format!("Typst compilation errors: {}", errors.join(", ")));
        }
    };

    // PDFを生成
    let pdf_options = typst_pdf::PdfOptions::default();

    // typst_pdf::pdfの戻り値を処理
    match typst_pdf::pdf(&document, &pdf_options) {
        Ok(pdf_bytes) => {
            // PDFファイルを書き込み
            fs::write(pdf_path, pdf_bytes)
                .map_err(|e| format!("Failed to write PDF file: {}", e))?;
            Ok(())
        }
        Err(errors) => Err(format!("PDF generation errors: {:?}", errors)),
    }
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_upload::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, generate_pdf_with_typst])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
