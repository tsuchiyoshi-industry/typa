//! 1人分の評価シート。

use super::str_dict;
use serde::{Deserialize, Serialize};
use typst::foundations::{Array, Dict, Value};

pub(super) const TEMPLATE: &str = "template.typ";
pub(super) const SOURCE: &str = include_str!("templates/template.typ");

#[derive(Debug, Serialize, Deserialize)]
struct PeriodGoalData {
    description: String,
    achievement: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObjectiveData {
    id: i32,
    goal_number: i32,
    challenge_goal: String,
    period_goals: Vec<PeriodGoalData>,
    #[serde(default)]
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
pub struct SheetExportData {
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
    // 評価を確定せずに締めた期間のシート。テンプレートが点数・ランク・評価者のコメントを「***」で伏せる。
    #[serde(default)]
    unconfirmed: bool,
    // 締め後修正(遡及処理)。テンプレートが赤字で1件1行に載せる。
    #[serde(default)]
    corrections: Vec<String>,
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
    dict.insert("unconfirmed".into(), Value::Bool(data.unconfirmed));
    dict.insert(
        "corrections".into(),
        Value::Array(
            data.corrections
                .iter()
                .map(|line| Value::Str(line.as_str().into()))
                .collect(),
        ),
    );

    let score = |s: Option<i32>| s.map_or(Value::Str("未評価".into()), |s| Value::Int(s.into()));

    let objectives: Array = data
        .objectives
        .iter()
        .map(|obj| {
            let period_goals = obj
                .period_goals
                .iter()
                .enumerate()
                .map(|(index, goal)| {
                    if obj.period_goals.len() == 1 {
                        goal.description.clone()
                    } else {
                        format!("{}. {}", index + 1, goal.description)
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            let achievements = if obj.period_goals.is_empty() {
                obj.achievement.clone()
            } else {
                obj.period_goals
                    .iter()
                    .enumerate()
                    .map(|(index, goal)| {
                        if obj.period_goals.len() == 1 {
                            goal.achievement.clone()
                        } else {
                            format!("{}. {}", index + 1, goal.achievement)
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            };
            let mut d = str_dict(&[
                ("challenge_goal", &obj.challenge_goal),
                ("period_goals", &period_goals),
                ("achievements", &achievements),
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
    use crate::compile_template;
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
                "periodGoals": [{"description": "手順書を作成し、現場で試行する", "achievement": "試行中。担当者の意見を集めている"}, {"description": "全員に改善内容を共有する", "achievement": ""}], "firstScore": null, "secondScore": "*"}],
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
    fn zero_period_goals_keeps_challenge_achievement() {
        let mut data = test_data(false);
        data.objectives[0].period_goals.clear();
        data.objectives[0].achievement = "チャレンジ目標の実績".into();
        let dict = to_dict(&data);
        let Value::Array(objectives) = dict.get("objectives").unwrap() else {
            panic!("objectives");
        };
        let Value::Dict(objective) = objectives.at(0, None).unwrap() else {
            panic!("objective");
        };
        assert_eq!(
            objective.get("achievements").unwrap(),
            &Value::Str("チャレンジ目標の実績".into())
        );
    }

    #[test]
    fn pdf_compiles_with_masked_values_and_literal_markup() {
        let directory = std::env::temp_dir().join(format!("typa-pdf-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("sheet.pdf");
        // 最終評価者が二次評価者の場合・一次評価者の場合、評価を確定せずに締めた場合でテンプレートがコンパイルできること
        let results: Vec<_> = [
            (false, false, 0),
            (false, false, 4),
            (true, false, 4),
            (false, true, 4),
        ]
        .into_iter()
        .map(|(primary_is_final_evaluator, unconfirmed, tasks)| {
            let mut data = test_data(primary_is_final_evaluator);
            data.unconfirmed = unconfirmed;
            data.objectives[0].achievement =
                "チャレンジ目標に対する実績。今期はここまで取り組んだ。".into();
            let task_description = data.objectives[0].period_goals[0].description.clone();
            let task_achievement = data.objectives[0].period_goals[0].achievement.clone();
            data.objectives[0].period_goals = (0..tasks)
                .map(|index| PeriodGoalData {
                    description: format!("タスク {}：{}", index + 1, task_description),
                    achievement: format!("実績 {}：{}", index + 1, task_achievement),
                })
                .collect();
            // 締め後修正の欄も、マークアップに見える文字ごと文字として載ること
            data.corrections = vec![
                "2026-10-23 チャレンジ目標 1・二次評価: 4 → 3(理由: *転記ミス* #eval(\"1\"))"
                    .into(),
            ];
            let result = compile_template(TEMPLATE, SOURCE, to_dict(&data))
                .map(|pdf| fs::write(&path, pdf).unwrap());
            if let Ok(preview_dir) = std::env::var("TYPA_PDF_PREVIEW_DIR") {
                let preview_dir = std::path::PathBuf::from(preview_dir);
                fs::create_dir_all(&preview_dir).unwrap();
                if result.is_ok() {
                    fs::copy(
                        &path,
                        preview_dir.join(format!(
                            "sheet-{}-{}-{}.pdf",
                            primary_is_final_evaluator, unconfirmed, tasks
                        )),
                    )
                    .unwrap();
                }
            }
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
