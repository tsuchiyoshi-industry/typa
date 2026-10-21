//! 全社の評価シート一覧(Admin 向け)。進み具合と、確定した結果。

use super::str_dict;
use serde::{Deserialize, Serialize};
use typst::foundations::{Array, Dict, Value};

pub(super) const TEMPLATE: &str = "sheet_overview.typ";
pub(super) const SOURCE: &str = include_str!("templates/sheet_overview.typ");

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SheetOverviewRowData {
    employee_no: String,
    employee_name: String,
    grade_name: String,
    // draft / submitted / first_evaluated / finalized。表示名はテンプレートが持つ。
    status: String,
    primary_evaluator: String,
    secondary_evaluator: String,
    // 確定した一次評価ランクと、一次評価者の総評。まだ無ければ空文字。
    first_rank: String,
    first_comment: String,
    // 確定した最終評価ランクと評価点、二次評価者の総評。まだ無ければ空文字。
    final_rank: String,
    final_score: String,
    second_comment: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SheetOverviewData {
    period_name: String,
    period_start: String,
    period_end: String,
    issued_at: String,
    issued_by: String,
    rows: Vec<SheetOverviewRowData>,
}

/// テンプレートの sys.inputs にする辞書。
pub(super) fn to_dict(data: &SheetOverviewData) -> Dict {
    let mut dict = str_dict(&[
        ("period_name", &data.period_name),
        ("period_start", &data.period_start),
        ("period_end", &data.period_end),
        ("issued_at", &data.issued_at),
        ("issued_by", &data.issued_by),
    ]);
    let rows: Array = data
        .rows
        .iter()
        .map(|row| {
            Value::Dict(str_dict(&[
                ("employee_no", &row.employee_no),
                ("employee_name", &row.employee_name),
                ("grade_name", &row.grade_name),
                ("status", &row.status),
                ("primary_evaluator", &row.primary_evaluator),
                ("secondary_evaluator", &row.secondary_evaluator),
                ("first_rank", &row.first_rank),
                ("first_comment", &row.first_comment),
                ("final_rank", &row.final_rank),
                ("final_score", &row.final_score),
                ("second_comment", &row.second_comment),
                ("updated_at", &row.updated_at),
            ]))
        })
        .collect();
    dict.insert("rows".into(), Value::Array(rows));
    dict
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::compile_template;
    use std::fs;

    #[test]
    fn sheet_overview_pdf_compiles_with_every_status_and_without_rows() {
        let row = |status: &str| {
            serde_json::json!({
                "employeeNo": "TEST001", "employeeName": "#read(\"secret.txt\")", "gradeName": "",
                "status": status, "primaryEvaluator": "[一次]", "secondaryEvaluator": "なし",
                "firstRank": if status == "draft" { "" } else { "B+" },
                "firstComment": "#include \"secret.txt\"\n2行目 *強調* [x]",
                "finalRank": if status == "finalized" { "A" } else { "" },
                "finalScore": if status == "finalized" { "88 点" } else { "" },
                "secondComment": "",
                "updatedAt": "2026/10/08"
            })
        };
        let overview = |rows: Vec<serde_json::Value>| -> SheetOverviewData {
            serde_json::from_value(serde_json::json!({
                "periodName": "テスト期間", "periodStart": "2026-04-01", "periodEnd": "2026-09-30",
                "issuedAt": "2026/10/08 14:30", "issuedBy": "#include \"secret.txt\"", "rows": rows
            }))
            .unwrap()
        };
        let with_rows = overview(
            // 知らない状態が来ても、帳票の生成は止めない
            [
                "draft",
                "submitted",
                "first_evaluated",
                "finalized",
                "unknown",
            ]
            .map(row)
            .to_vec(),
        );
        let dict = to_dict(&with_rows);
        assert_eq!(
            dict.get("issued_by").unwrap(),
            &Value::Str("#include \"secret.txt\"".into())
        );

        let directory =
            std::env::temp_dir().join(format!("typa-overview-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("overview.pdf");
        let results: Vec<_> = [with_rows, overview(vec![])]
            .iter()
            .map(|data| {
                let result = compile_template(TEMPLATE, to_dict(data), &path);
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
