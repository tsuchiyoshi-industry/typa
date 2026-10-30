//! 評価シートの PDF。Typst のテンプレートにデータを流し込む。
//! デスクトップは Tauri のコマンドから、ブラウザは WASM から同じ関数を呼ぶ。

mod overview;
mod sheet;
#[cfg(any(target_arch = "wasm32", test))]
mod wasm;

pub use overview::SheetOverviewData;
pub use sheet::SheetExportData;
use std::sync::LazyLock;
use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime, Dict, Duration, Value};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};

static FONT: &[u8] = include_bytes!("templates/ZenAntiqueSoft-Regular.ttf");

// フォント(7MB)の解析は重いので、一度だけ行って使い回す
static FONTS: LazyLock<(LazyHash<FontBook>, Vec<Font>)> = LazyLock::new(|| {
    let fonts: Vec<Font> = Font::iter(Bytes::new(FONT)).collect();
    (LazyHash::new(FontBook::from_fonts(&fonts)), fonts)
});

/// 1人分の評価シートの PDF。
pub fn sheet_pdf(data: &SheetExportData) -> Result<Vec<u8>, String> {
    compile_template(sheet::TEMPLATE, sheet::SOURCE, sheet::to_dict(data))
}

/// 全社の評価シート一覧の PDF。
pub fn overview_pdf(data: &SheetOverviewData) -> Result<Vec<u8>, String> {
    compile_template(
        overview::TEMPLATE,
        overview::SOURCE,
        overview::to_dict(data),
    )
}

fn str_dict(pairs: &[(&str, &str)]) -> Dict {
    let mut dict = Dict::new();
    for (key, value) in pairs {
        dict.insert((*key).into(), Value::Str((*value).into()));
    }
    dict
}

/// テンプレート1枚と同梱フォントだけの Typst の世界。ほかのファイルは読ませない。
struct Template {
    library: LazyHash<Library>,
    main: Source,
}

impl World for Template {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &FONTS.0
    }

    fn main(&self) -> FileId {
        self.main.id()
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main.id() {
            Ok(self.main.clone())
        } else {
            Err(FileError::AccessDenied)
        }
    }

    fn file(&self, _id: FileId) -> FileResult<Bytes> {
        Err(FileError::AccessDenied)
    }

    fn font(&self, index: usize) -> Option<Font> {
        FONTS.1.get(index).cloned()
    }

    // テンプレートは今日の日付を使わない(発行日などは inputs で渡す)。ブラウザで時計を読まずに済む
    fn today(&self, _offset: Option<Duration>) -> Option<Datetime> {
        None
    }
}

// inputs はラップせずに渡すので、テンプレート側では sys.inputs がこの辞書そのものになる
fn compile_template(name: &str, source: &str, inputs: Dict) -> Result<Vec<u8>, String> {
    let path = VirtualPath::new(name).map_err(|e| format!("Typst path is invalid: {e:?}"))?;
    let world = Template {
        library: LazyHash::new(Library::builder().with_inputs(inputs).build()),
        main: Source::new(
            RootedPath::new(VirtualRoot::Project, path).intern(),
            source.into(),
        ),
    };
    let result = typst::compile(&world);
    // 直近10回分のコンパイル結果だけ残し、続けて出力するときはレイアウト等を再利用する
    comemo::evict(10);
    if !result.warnings.is_empty() {
        eprintln!("Typst warnings: {:?}", result.warnings);
    }
    let doc = result
        .output
        .map_err(|e| format!("Typst compilation failed: {:?}", e))?;
    typst_pdf::pdf(&doc, &typst_pdf::PdfOptions::default())
        .map_err(|e| format!("PDF generation failed: {:?}", e))
}
