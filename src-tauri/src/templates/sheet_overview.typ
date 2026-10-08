#import sys: inputs

// 全社の評価シート一覧(Admin 向け)。1つの評価期間の全シートの進み具合と、確定した結果を載せる。

#let ink = rgb("#1f2328")
#let muted = rgb("#6b7178")
#let hairline = rgb("#d5d8dc")
#let wash = rgb("#f4f5f6")
#let accent = rgb("#3d6a9e")

// 進行順。表示名は画面と同じ言葉にする
#let stages = (
  (key: "draft", label: "下書き", shade: luma(205)),
  (key: "submitted", label: "一次評価待ち", shade: luma(150)),
  (key: "first_evaluated", label: "二次評価待ち", shade: luma(95)),
  (key: "finalized", label: "最終評価済み", shade: accent),
)
#let stage-of(key) = {
  let index = stages.position(stage => stage.key == key)
  if index == none { 0 } else { index }
}

#let rows = inputs.rows
#let counts = stages.map(stage => rows.filter(row => row.status == stage.key).len())
#let small(body) = text(size: 7.5pt, fill: muted, body)
#let dash(value) = if value == "" { text(fill: muted)[—] } else { value }

// 4つの升目を、いまの段まで塗る。白黒で刷っても、どこまで進んだかが形で分かる
#let pips(key) = {
  let reached = stage-of(key)
  let tone = if reached == 3 { accent } else { ink }
  stack(
    dir: ltr,
    spacing: 1.3pt,
    ..range(4).map(step => rect(
      width: 4.4pt,
      height: 4.4pt,
      fill: if step <= reached { tone },
      stroke: 0.45pt + (if step <= reached { tone } else { muted }),
    )),
  )
}

#set page(
  paper: "a4",
  margin: (x: 14mm, top: 15mm, bottom: 17mm),
  footer: context grid(
    columns: (1fr, auto),
    small[#inputs.period_name　評価シート一覧],
    small[#counter(page).display("1 / 1", both: true)],
  ),
)
#set text(size: 8.5pt, lang: "ja", font: "Zen Antique Soft", fill: ink)

// ----- 見出し: どの期間の一覧か、いつ誰が出したか -----
#grid(
  columns: (1fr, auto),
  align: (left + bottom, right + bottom),
  stack(
    spacing: 7pt,
    text(size: 7.5pt, fill: muted, tracking: 0.2em)[評価シート一覧],
    text(size: 20pt)[#inputs.period_name],
    small[#inputs.period_start ～ #inputs.period_end],
  ),
  stack(
    spacing: 5pt,
    small[出力日時　#inputs.issued_at],
    small[出力者　#inputs.issued_by],
  ),
)
#v(7pt)
#line(length: 100%, stroke: 1.1pt + ink)
#v(5pt)

// ----- 全体の進み具合: 帯の幅が、その段にあるシートの割合 -----
#let present = range(4).filter(index => counts.at(index) > 0)
#if present.len() > 0 {
  grid(
    columns: present.map(index => counts.at(index) * 1fr),
    column-gutter: 1.5pt,
    ..present.map(index => rect(width: 100%, height: 5pt, fill: stages.at(index).shade)),
  )
  v(6pt)
}
#grid(
  columns: (1fr, 1fr, 1fr, 1fr, auto),
  align: horizon,
  ..range(4).map(index => grid(
    columns: 3,
    column-gutter: 4.5pt,
    align: horizon,
    rect(width: 5pt, height: 5pt, fill: stages.at(index).shade),
    small(stages.at(index).label),
    text(size: 11pt)[#counts.at(index)],
  )),
  [#small[計] #text(size: 11pt)[#rows.len()] #small[件]],
)
#v(11pt)

// ----- 一覧: 社員番号順 -----
#table(
  columns: (auto, auto, 1.25fr, 1fr, auto, 1fr, 1fr, auto, auto),
  inset: (x: 5pt, y: 5.5pt),
  align: (x, _) => if x == 0 { right + horizon } else { left + horizon },
  stroke: (_, y) => (bottom: if y == 0 { 0.8pt + ink } else { 0.4pt + hairline }),
  fill: (_, y) => if y > 0 and calc.even(y) { wash },
  table.header(
    ..("No.", "社員番号", "氏名", "作成時の等級", "ステータス", "一次評価者", "二次評価者", "最終評価", "最終更新").map(title => text(
      size: 7pt,
      fill: muted,
      title,
    )),
  ),
  ..rows
    .enumerate()
    .map(entry => {
      let row = entry.at(1)
      let stage = stages.at(stage-of(row.status))
      (
        text(fill: muted)[#(entry.at(0) + 1)],
        [#row.employee_no],
        [#row.employee_name],
        [#dash(row.grade_name)],
        grid(
          columns: 2,
          column-gutter: 5pt,
          align: horizon,
          pips(row.status), text(stage.label),
        ),
        [#row.primary_evaluator],
        [#row.secondary_evaluator],
        [#dash(row.final_evaluation)],
        text(fill: muted)[#row.updated_at],
      )
    })
    .flatten(),
)

#v(8pt)
#small[最終評価は、評価が確定したシートの評価点（100点満点）と評価ランクです。]
