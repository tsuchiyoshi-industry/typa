#import sys: inputs

#set page(paper: "a4", margin: 2cm)
#set text(size: 10pt, lang: "ja", font: ("Zen Antique Soft"))
#set par(justify: true)

// 見出しのスタイル定義
#show heading.where(level: 1): it => [
  #set text(size: 14pt)
  #block(
    fill: luma(240),
    inset: 8pt,
    radius: 2pt,
    width: 100%,
    it
  )
  #v(0.5em)
]

#show heading.where(level: 2): it => [
  #set text(size: 11pt)
  #v(1em)
  #it
  #v(0.5em)
]

// タイトル
#align(center)[
  #text(size: 18pt, weight: "bold")[人事考課評価シート]
]

#v(1em)

// 基本情報
#table(
  columns: (1fr, 2fr, 1fr, 2fr),
  stroke: 0.5pt + luma(150),
  inset: 8pt,
  fill: (x, y) => if calc.even(x) { luma(245) },
  [*氏名*], [#inputs.employee_name], [*社員番号*], [#inputs.employee_no],
  [*評価期間*], [#inputs.period_name], [*期間*], [#inputs.period_start ～ #inputs.period_end],
  [*一次評価者*], [#inputs.primary_evaluator], [*二次評価者*], [#inputs.secondary_evaluator],
  [*ステータス*], [#inputs.status], [*総合スコア*], [#text(weight: "bold")[#inputs.total_score]],
)

#v(1.5em)

#heading(level: 1)[目標・マイルストーン]

#for (idx, obj) in inputs.objectives.enumerate() {
  heading(level: 2)[目標 #obj.goal_number]
  
  table(
    columns: (1fr, 4fr),
    stroke: 0.5pt + luma(180),
    inset: 8pt,
    [*チャレンジ目標*], [ #obj.challenge_goal ],
    [*中間目標*], [ #obj.midterm_goal ],
    [*達成状況*], [ #obj.achievement ],
  )
  
  // スコアとコメントの対比
  table(
    columns: (1fr, 1fr),
    fill: luma(250),
    stroke: 0.5pt + luma(180),
    inset: 8pt,
    [*自己評価スコア*], [*評価者スコア*],
    [#obj.self_score], [#obj.evaluator_score]
  )
}

#heading(level: 1)[共通評価項目]

#table(
  columns: (2fr, 1fr, 1fr, 3fr, 3fr),
  stroke: 0.5pt + luma(180),
  inset: 6pt,
  fill: luma(245),
  [*評価項目*], [*自己*], [*評価者*], [*自己コメント*], [*評価者コメント*],
  ..inputs.common_evaluations.map(item => (
    [#item.item_name],
    [#item.self_score],
    [#item.evaluator_score],
    [#set text(size: 9pt); #item.self_comment],
    [#set text(size: 9pt); #item.evaluator_comment]
  )).flatten()
)