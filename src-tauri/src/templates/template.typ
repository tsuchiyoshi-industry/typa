#import sys: inputs

#let line = luma(95)
#let pale = luma(242)
#let header = luma(226)
#let muted = luma(115)

#let empty(value) = if value == "" {
  text(fill: muted)[未記入]
} else {
  value
}

#let score(value) = {
  value
}

#let section(title) = [
  #v(1.1em)
  #block(
    width: 100%,
    fill: header,
    stroke: 0.7pt + line,
    inset: (x: 7pt, y: 5pt),
  )[
    #text(size: 10.5pt, weight: "bold")[#title]
  ]
  #v(0.55em)
]

#let label-cell(body) = {
  set text(weight: "bold")
  body
}

#let note-box(title, body) = [
  #text(size: 9.5pt, weight: "bold")[#title]
  #v(0.25em)
  #block(width: 100%, stroke: 0.55pt + line, inset: 6pt)[
    #empty(body)
  ]
]

#set page(
  paper: "a4",
  margin: (top: 18mm, bottom: 16mm, left: 17mm, right: 17mm),
  header: align(right)[#text(size: 7.5pt, fill: muted)[Sheet ID: #inputs.sheet_id]],
  footer: context align(center)[#text(size: 7.5pt, fill: muted)[Page #counter(page).display()]],
)
#set text(size: 9pt, lang: "ja", font: ("Zen Antique Soft"))
#set par(justify: true, leading: 0.58em)

#align(center)[
  #text(size: 15pt, weight: "bold")[人事考課評価シート]
  #v(0.25em)
  #text(size: 8pt, fill: muted)[評価期間: #inputs.period_start ～ #inputs.period_end]
]

#v(0.8em)

#table(
  columns: (22mm, 1fr, 24mm, 1fr, 22mm, 1fr),
  stroke: 0.55pt + line,
  inset: (x: 6pt, y: 5pt),
  fill: (x, y) => if calc.even(x) { pale },
  [#label-cell[氏名]], [#inputs.employee_name],
  [#label-cell[社員番号]], [#inputs.employee_no],
  [#label-cell[等級]], [#empty(inputs.grade_name)],
  [#label-cell[評価期]], [#inputs.period_name],
  [#label-cell[コース]], [#empty(inputs.career_course)],
  [#label-cell[状態]], [#inputs.status],
  [#label-cell[一次評価者]], [#inputs.primary_evaluator],
  [#label-cell[二次評価者]], [#inputs.secondary_evaluator],
  [#label-cell[総合点]], [#text(weight: "bold")[#inputs.total_score]],
)

#v(0.75em)

#table(
  columns: (1fr, 1fr, 1fr),
  stroke: 0.55pt + line,
  inset: (x: 6pt, y: 8pt),
  align: center,
  fill: (x, y) => if y == 0 { header },
  [本人確認], [一次評価確認], [二次評価確認],
  [ ], [ ], [ ],
)

#section[チャレンジ目標・マイルストーン]

#if inputs.objectives.len() == 0 [
  #block(width: 100%, stroke: 0.55pt + line, inset: 8pt)[
    #text(fill: muted)[登録された目標はありません。]
  ]
] else [
  #for obj in inputs.objectives [
    #block(
      width: 100%,
      stroke: 0.7pt + line,
      inset: 0pt,
      breakable: true,
    )[
      #block(fill: pale, inset: (x: 6pt, y: 4pt), width: 100%)[
        #text(weight: "bold")[目標 #obj.goal_number]
      ]
      #table(
        columns: (28mm, 1fr),
        stroke: 0.45pt + line,
        inset: (x: 6pt, y: 5pt),
        [#label-cell[チャレンジ目標]], [#empty(obj.challenge_goal)],
        [#label-cell[中間目標]], [#empty(obj.midterm_goal)],
        [#label-cell[達成状況]], [#empty(obj.achievement)],
      )
      #table(
        columns: (28mm, 1fr, 28mm, 1fr),
        stroke: 0.45pt + line,
        inset: (x: 6pt, y: 5pt),
        fill: (x, y) => if calc.even(x) { pale },
        [#label-cell[一次評価]], [#score(obj.self_score)],
        [#label-cell[二次評価]], [#score(obj.evaluator_score)],
      )
    ]
    #v(0.65em)
  ]
]

#section[役職共通評価]

#if inputs.common_evaluations.len() == 0 [
  #block(width: 100%, stroke: 0.55pt + line, inset: 8pt)[
    #text(fill: muted)[対象となる共通評価項目はありません。]
  ]
] else [
  #table(
    columns: (22mm, 1.35fr, 2fr, 13mm, 16mm, 16mm, 2fr),
    stroke: 0.45pt + line,
    inset: (x: 4pt, y: 4.5pt),
    fill: (x, y) => if y == 0 { header } else if calc.odd(y) { luma(250) },
    [区分], [評価項目], [評価観点], [配点], [一次], [二次], [一次評価者コメント],
    ..inputs.common_evaluations.map(item => (
      [共通],
      [#item.item_name],
      [#item.item_description],
      [#item.weight],
      [#score(item.self_score)],
      [#score(item.evaluator_score)],
      [#empty(item.self_comment)],
    )).flatten()
  )
]

#section[総評]

#grid(
  columns: (1fr, 1fr),
  gutter: 8pt,
  note-box("一次評価者 総評", inputs.first_overall_comment),
  note-box("二次評価者 総評", inputs.second_overall_comment),
)
