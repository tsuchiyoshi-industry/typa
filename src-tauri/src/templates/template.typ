#import sys: inputs

#let black = luma(0)
#let grid-line = luma(0)
#let sheet-green = rgb("#e2efda")
#let muted = luma(115)
#let red = rgb("#ff0000")

#let blank = text(fill: muted)[]
#let empty(value) = if value == "" {
  blank
} else {
  value
}

#let score(value) = if value == "未評価" {
  text(fill: muted)[-]
} else {
  value
}

#let red-score(value) = text(fill: red)[#score(value)]
#let point(value) = [#value 点]
#let rate(value) = [#value%]
#let label(title) = text(size: 6pt, weight: "bold")[#title]
#let title-cell(body) = table.cell(fill: black, align: center + horizon)[
  #text(fill: white, size: 5.3pt, weight: "bold")[#body]
]
#let green-cell(body) = table.cell(fill: sheet-green)[#body]
#let centered(body) = table.cell(align: center + horizon)[#body]
#let final-rank(value) = if value == "" {
  text(fill: muted)[未決定]
} else {
  text(size: 10pt, weight: "bold")[#value]
}

#let score-summary-table() = {
  table(
    columns: (28mm, 16mm, 18mm, 22mm),
    stroke: 0.45pt + grid-line,
    inset: (x: 2.6pt, y: 2.5pt),
    align: center + horizon,
    table.cell(colspan: 4, fill: black, align: left)[
      #text(fill: white, size: 5.8pt, weight: "bold")[評価集計欄]
    ],
    table.cell(rowspan: 2)[評価区分],
    table.cell(rowspan: 2)[配分],
    table.cell(colspan: 2)[上司評価],
    [#text(size: 5pt)[獲得率(%)]],
    [#text(size: 5pt)[評価点] #linebreak() #text(size: 4.3pt)[配点×獲得率]],
    [チャレンジ目標評価],
    [#point(inputs.objective_allocation_score)],
    [#rate(inputs.objective_second_rate)],
    [#point(inputs.objective_evaluation_score)],
    [共通評価],
    [#point(inputs.common_evaluation_allocation_score)],
    [#rate(inputs.common_evaluation_second_rate)],
    [#point(inputs.common_evaluation_evaluation_score)],
    table.cell(colspan: 2)[評価点],
    table.cell(colspan: 2)[#point(inputs.total_evaluation_score)],
    table.cell(colspan: 2)[【二次評価者】最終評価ランク],
    table.cell(colspan: 2, fill: sheet-green)[#final-rank(inputs.final_evaluation_rank)],
  )
}

#let profile-tables() = [
  #text(size: 10pt, weight: "bold")[□評価シート]
  #v(2pt)
  #table(
    columns: (18mm, 18mm, 32mm),
    stroke: 0.45pt + grid-line,
    inset: (x: 3pt, y: 2.4pt),
    align: center + horizon,
    title-cell[コース区分],
    title-cell[等級],
    title-cell[評価対象期間],
    green-cell(text(fill: red, weight: "bold")[#empty(inputs.career_course)]),
    green-cell(text(fill: red, weight: "bold")[#empty(inputs.grade_name)]),
    green-cell(text(fill: red, weight: "bold")[#inputs.period_start ～ #inputs.period_end]),
  )
  #v(8pt)
  #table(
    columns: (24mm, 34mm),
    stroke: 0.45pt + grid-line,
    inset: (x: 3pt, y: 2.4pt),
    align: center + horizon,
    title-cell[],
    title-cell[氏名],
    title-cell[評価対象者],
    green-cell[#inputs.employee_name],
    title-cell[一次評価者],
    green-cell[#inputs.primary_evaluator],
    title-cell[二次評価者],
    green-cell[#inputs.secondary_evaluator],
  )
]

#let section-title(title) = [
  #v(5pt)
  #label(title)
  #v(1.5pt)
]

#let challenge-table() = {
  table(
    columns: (5mm, 50mm, 52mm, 52mm, 13mm, 13mm, 14mm),
    stroke: 0.43pt + grid-line,
    inset: (x: 2pt, y: 3pt),
    align: horizon,
    title-cell[no],
    title-cell[(本人)チャレンジ目標],
    title-cell[【本人】期中目標],
    title-cell[【本人】期中取組んだこと、実績],
    title-cell[配点],
    title-cell(text(size: 4.7pt)[【一次評価者】 #linebreak() 上司評価]),
    title-cell(text(size: 4.7pt)[【二次評価者】 #linebreak() 修正後評価]),
    ..inputs.objectives.map(obj => (
      centered[#obj.goal_number],
      green-cell[#empty(obj.challenge_goal)],
      green-cell[#empty(obj.midterm_goal)],
      green-cell[#empty(obj.achievement)],
      centered[1],
      table.cell(fill: sheet-green, align: center + horizon)[#red-score(obj.self_score)],
      table.cell(fill: sheet-green, align: center + horizon)[#red-score(obj.evaluator_score)],
    )).flatten()
  )
}

#let challenge-summary() = align(right)[
  #table(
    columns: (37mm, 13mm, 14mm),
    stroke: 0.43pt + grid-line,
    inset: (x: 2.2pt, y: 2pt),
    align: center + horizon,
    table.cell(colspan: 1, stroke: none)[評価合計点],
    [#point(inputs.objective_allocation_score)],
    [#point(inputs.objective_evaluation_score)],
    table.cell(colspan: 1, stroke: none)[獲得率（評価合計点÷満点）],
    [100%],
    [#rate(inputs.objective_second_rate)],
  )
]

#let common-table() = {
  table(
    columns: (5mm, 23mm, 66mm, 66mm, 13mm, 13mm, 14mm),
    stroke: 0.43pt + grid-line,
    inset: (x: 2pt, y: 2.2pt),
    align: horizon,
    title-cell[no],
    title-cell[評価項目],
    title-cell[評価上の着眼点],
    title-cell[【一次評価者】評価コメント],
    title-cell[配点],
    title-cell(text(size: 4.7pt)[【一次評価者】 #linebreak() 上司評価]),
    title-cell(text(size: 4.7pt)[【二次評価者】 #linebreak() 修正後評価]),
    ..range(inputs.common_evaluations.len()).map(index => {
      let item = inputs.common_evaluations.at(index)
      (
        centered[#(index + 1)],
        [#item.item_name],
        [#item.item_description],
        green-cell[#empty(item.self_comment)],
        centered[#item.weight],
        table.cell(fill: sheet-green, align: center + horizon)[#red-score(item.self_score)],
        table.cell(fill: sheet-green, align: center + horizon)[#red-score(item.evaluator_score)],
      )
    }).flatten()
  )
}

#let common-summary() = align(right)[
  #table(
    columns: (37mm, 13mm, 14mm),
    stroke: 0.43pt + grid-line,
    inset: (x: 2.2pt, y: 2pt),
    align: center + horizon,
    table.cell(colspan: 1, stroke: none)[評価合計点],
    [#point(inputs.common_evaluation_allocation_score)],
    [#point(inputs.common_evaluation_evaluation_score)],
    table.cell(colspan: 1, stroke: none)[獲得率（評価合計点÷満点）],
    [100%],
    [#rate(inputs.common_evaluation_second_rate)],
  )
]

#let comment-and-approval() = grid(
  columns: (1fr, 28mm),
  gutter: 10mm,
  table(
    columns: (1fr, 1fr),
    stroke: 0.5pt + grid-line,
    inset: (x: 3pt, y: 3pt),
    title-cell[【一次評価者】コメント欄],
    title-cell[【二次評価者】コメント欄],
    table.cell(fill: sheet-green)[#block(width: 100%, height: 22mm)[#empty(inputs.first_overall_comment)]],
    table.cell(fill: sheet-green)[#block(width: 100%, height: 22mm)[#empty(inputs.second_overall_comment)]],
  ),
  align(bottom)[
    #table(
      columns: (1fr, 1fr),
      stroke: 0.45pt + grid-line,
      inset: (x: 1.7pt, y: 1.6pt),
      align: center + horizon,
      table.cell(colspan: 2, fill: black)[
        #text(fill: white, size: 5.3pt, weight: "bold")[承認欄]
      ],
      [一次評価者], [二次評価者],
      [日　付], [日　付],
      [月　日], [月　日],
      table.cell(fill: sheet-green)[#block(width: 100%, height: 12mm)[]],
      table.cell(fill: sheet-green)[#block(width: 100%, height: 12mm)[]],
    )
  ],
)

#set page(
  paper: "a4",
  margin: (top: 5mm, bottom: 5mm, left: 5mm, right: 5mm),
)
#set text(size: 5.7pt, lang: "ja", font: ("Zen Antique Soft"))
#set par(justify: true, leading: 0.42em)

#grid(
  columns: (1fr, 84mm),
  gutter: 8mm,
  profile-tables(),
  align(top + right)[#score-summary-table()],
)

#section-title[チャレンジ目標評価]
#challenge-table()
#challenge-summary()

#section-title[共通評価]
#common-table()
#common-summary()

#v(7pt)
#comment-and-approval()
