//! 1人分の評価シート。

use super::str_dict;
use serde::{Deserialize, Serialize};
use typst::foundations::{Array, Dict, Value};

pub(super) const TEMPLATE: &str = "template.typ";
pub(super) const SOURCE: &str = include_str!("templates/template.typ");

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
pub(crate) struct SheetExportData {
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

/// テンプレートの sys.inputs にする辞書。
pub(super) fn to_dict(data: &SheetExportData) -> Dict {
    let mut dict = str_dict(&[
        ("employee_name", &data.employee_name),
        ("employee_no", &data.employee_no),
        ("career_course", &data.career_course),
        ("grade_name", &data.grade_name),
        ("period_name", &data.period_name),
        ("period_start", &data.period_start),
        ("period_end", &data.period_end),
        ("primary_evaluator", &data.primary_evaluator),
        ("secondary_evaluator", &data.secondary_evaluator),
        ("status", &data.status),
        ("final_evaluation_rank", &data.final_evaluation_rank),
        ("objective_second_rate", &data.objective_second_rate),
        (
            "objective_evaluation_score",
            &data.objective_evaluation_score,
        ),
        (
            "common_evaluation_second_rate",
            &data.common_evaluation_second_rate,
        ),
        (
            "common_evaluation_evaluation_score",
            &data.common_evaluation_evaluation_score,
        ),
        ("total_evaluation_score", &data.total_evaluation_score),
        ("first_overall_comment", &data.first_overall_comment),
        ("second_overall_comment", &data.second_overall_comment),
    ]);
    for (key, value) in [
        ("sheet_id", data.sheet_id),
        (
            "objective_allocation_score",
            data.objective_allocation_score,
        ),
        (
            "common_evaluation_allocation_score",
            data.common_evaluation_allocation_score,
        ),
    ] {
        dict.insert(key.into(), Value::Int(value.into()));
    }
    dict.insert(
        "primary_is_final_evaluator".into(),
        Value::Bool(data.primary_is_final_evaluator),
    );

    let score = |s: Option<i32>| s.map_or(Value::Str("未評価".into()), |s| Value::Int(s.into()));

    let objectives: Array = data
        .objectives
        .iter()
        .map(|obj| {
            let mut d = str_dict(&[
                ("challenge_goal", &obj.challenge_goal),
                ("midterm_goal", &obj.midterm_goal),
                ("achievement", &obj.achievement),
                ("second_score", &obj.second_score),
            ]);
            d.insert("goal_number".into(), Value::Int(obj.goal_number.into()));
            d.insert("first_score".into(), score(obj.first_score));
            Value::Dict(d)
        })
        .collect();
    dict.insert("objectives".into(), Value::Array(objectives));

    let common_evaluations: Array = data
        .common_evaluations
        .iter()
        .map(|item| {
            let mut d = str_dict(&[
                ("item_name", &item.item_name),
                ("item_description", &item.item_description),
                ("second_score", &item.second_score),
                (
                    "first_comment",
                    item.first_comment.as_deref().unwrap_or("なし"),
                ),
            ]);
            d.insert("weight".into(), Value::Int(item.weight.into()));
            d.insert("first_score".into(), score(item.first_score));
            Value::Dict(d)
        })
        .collect();
    dict.insert(
        "common_evaluations".into(),
        Value::Array(common_evaluations),
    );

    dict
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::pdf::compile_template;
    use std::fs;

    pub(crate) fn test_data(primary_is_final_evaluator: bool) -> SheetExportData {
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

    #[test]
    fn typst_input_remains_literal_data() {
        let data = test_data(false);
        let dict = to_dict(&data);
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
                let result = compile_template(
                    TEMPLATE,
                    to_dict(&test_data(primary_is_final_evaluator)),
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
