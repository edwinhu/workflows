// Short teaching deck for class 4. Built from inventory/content-inventory-04-01.md, the SAME
// inventory the 104-slide reference deck (tag 04-tornetta-full) is checked against: 91 of the
// 100 items over 39 slides. A #include'd file has its own scope, so the master's import does
// not reach it, and the overflow and widow checkers compile this chapter through their own
// wrappers.
#import "../../templates/theme.typ": *
// Shared figure, not a copy: the January 31, 2024 poll chart lives with the long deck.
#import "../04-tornetta/poll-figure.typ": x-poll-figure

// Runt control, swept on the long deck: slide bullets are unjustified, so par.linebreaks
// defaults to "simple" and text.costs.runt is inert until linebreaks are optimized.
#set par(linebreaks: "optimized")
#set text(costs: (runt: 5000%))

// Director portraits. Mirvis puts seven headshots on his Decision Makers slides; the material
// is in assets/ and the pattern reads better than a list of names.
#let head(file, name, size: 2.1cm) = align(center)[
  #box(clip: true, radius: 0.2em, image("../../assets/" + file, height: size))
  #v(-0.4em)
  #text(size: 13pt, weight: "semibold")[#name]
]


= The Case


== The Case and the Grant

// DOC-1 and DOC-4, TM-05 sec. 1.1-1.2. The title is the opinion's own first sentence. The trial
// record is the opinion's breakdown, never Mirvis slide 2's "32 fact witnesses and nine experts."
#slide[
  === Was the richest person in the world overpaid?

  #set text(18pt)

  - _Tornetta v. Musk_, 310 A.3d 430 (Del. Ch. 2024) (McCormick, C.), is a stockholder derivative suit claiming that Tesla's directors breached their fiduciary duties by awarding Elon Musk a performance-based equity plan. Trial ran five days, on 1,704 exhibits, deposition testimony from 23 fact and five expert witnesses, and 255 stipulations of~fact. #pause

  - "With a \$55.8 billion maximum value and \$2.6 billion grant date fair value, the plan is the largest potential compensation opportunity ever observed in public markets by multiple orders of magnitude --- 250 times larger than the contemporaneous median peer compensation plan and over 33 times larger than the plan's closest comparison, which was Musk's prior compensation plan." #pause

  - Entire fairness governs, the defendants bore the burden of proving the plan fair, and they failed to meet~it. #pause

  #quote(block: true)[In the final analysis, Musk launched a self-driving process, recalibrating the speed and direction along the way as he saw fit. The process arrived at an unfair price. And through this litigation, the plaintiff requests a recall.]
]

// DOC-2, TM-05 sec. 1.2. Diagram and table together: the two operational columns are
// ALTERNATIVES rather than a pair, which is the fact most likely to be misread, and the AND
// junction is the half of every vesting condition a description keyed only to the \$50 billion
// steps drops. The long deck's third slide of prose (share mechanics, strike price, the four
// other terms) is dropped; the terms reappear where they do work, on fair dealing.
#slide[
  === The Grant: twelve tranches, two milestones each.

  #set text(16pt)

  #grid(
    columns: (1fr, 1.05fr),
    gutter: 1.2em,
    align(horizon)[
      #align(center)[
        #set text(12pt)
        // Storytelling: the two milestone families read as one ladder and one menu, and the BOTH
        // junction is what makes the pair conjunctive rather than alternative --- the half of every
        // vesting condition a description keyed only to the \$50 billion steps drops.
        #fletcher-diagram(
          node-stroke: 1pt,
          edge-stroke: 1pt,
          spacing: (2em, 1.4em),
          node-inset: 0.4em,
          node(
            (0, 0),
            [*12 market-capitalization*\ *milestones*\ \$100 billion to \$650 billion,\ in \$50 billion increments],
            shape: rect,
            name: <mc>,
            fill: rgb("#b8c9e8"),
          ),
          node(
            (0, 2),
            [*16 operational*\ *milestones*\ eight revenue,\ eight adjusted EBITDA],
            shape: rect,
            name: <op>,
            fill: rgb("#c8e6c9"),
          ),
          node((1, 1), text(size: 1.1em)[*BOTH*], shape: circle, name: <and>, fill: rgb("#e8e8e8")),
          node(
            (2, 1),
            [*One tranche vests*\ options on 1% of\ common stock\ outstanding],
            shape: rect,
            name: <tr>,
            fill: rgb("#ffe0b2"),
          ),
          edge(<mc>, <and>, "-|>", label: text(size: 1.05em, weight: "semibold")[any one]),
          edge(<op>, <and>, "-|>", label: text(size: 1.05em, weight: "semibold")[any one]),
          edge(<and>, <tr>, "-|>"),
        )
      ]
      #v(0.6em)
      #align(center)[The table's eight rows and two columns are the 16 operational milestones. The columns are *alternatives*: hitting either figure on a row satisfies~one.]
    ],
    [
      #align(center)[#table(
        columns: (auto, auto, auto),
        align: (center, right, right),
        stroke: 0.5pt,
        inset: 10pt,
        table.header([\#], [*Revenue\ (billions)*], [*Adj. EBITDA\ (billions)*]),
        [1], [\$20.0], [\$1.5],
        [2], [\$35.0], [\$3.0],
        [3], [\$55.0], [\$4.5],
        [4], [\$75.0], [\$6.0],
        [5], [\$100.0], [\$8.0],
        [6], [\$125.0], [\$10.0],
        [7], [\$150.0], [\$12.0],
        [8], [\$175.0], [\$14.0],
      )]
    ],
  )

  - The Board approved on January 21, 2018 --- Musk and Kimbal recused, Jurvetson on leave, the other six unanimous --- and "conditioned the 2018 Grant on approval by a majority vote of disinterested~stockholders."
]

== The Record and the Standard of Review

// QUOTE-2 and DOC-6, TM-05 sec. 1.1.
#slide[
  === Paying the CEO is the quintessential business determination.

  #set text(18pt)

  #quote(block: true)[A board of director's decision on how much to pay a company's chief executive officer is the quintessential business determination subject to great judicial deference. But Delaware law recognizes unique risks inherent in a corporation's transactions with its controlling stockholder. Given those risks, under Delaware law, the presumptive standard of review for conflicted-controller transactions is entire~fairness.] #pause

  - Entire fairness put the burden on the defendants. The one route out was a fully informed majority-of-the-minority vote, and Tesla did condition the Grant on~one. #pause

  - "But the defendants were unable to prove that the stockholder vote was fully informed because the proxy statement inaccurately described key directors as independent and misleadingly omitted details about the~process."

  #callout["The plaintiff thus forces the question: Does Musk control~Tesla?"]
]

// DOC-8 and DOC-7, TM-05 secs. 1.3 and 3.2. Footnote 546 travels to the last slide, where it
// is the hinge of the closing question.
#slide[
  === The holding is a chain: controller status to total rescission.

  - Controlling stockholder, so entire fairness. #pause

  - Lack of committee independence. #pause

  - Uninformed stockholder vote. #pause

  - Process unfair. #pause

  - Price unfair. #pause

  - *Rescission in its entirety.* #pause

  - The plaintiff advanced two theories: a conflicted controller, and a board half of whose approving directors lacked independence. The court reached only the first. Footnote 546: "The factual findings that render Musk a controller, however, support a finding that the majority of the Board lacked~independence."
]


= Does Musk Control Tesla?


== Control: Doctrine and Ownership

// DOC-10 with one sentence of DOC-9, TM-05 sec. 1.3. [KC-3]: the figure is 21.9%, not 21%.
#slide[
  === Mathematical control, effective control, four indicia.

  #set text(17pt)

  - Delaware vests control in the board and imposes the fiduciary duties there. "When a controller displaces or neutralizes a board's power to direct corporate action, then the controller assumes fiduciary~obligations." #pause

  - A holder of a mathematical majority "has the ability to exercise affirmative control." "Musk controlled only 21.9% of Tesla's voting power, so he lacked mathematical voting control." But "control of the ballot box is not always~dispositive." #pause

  - _Basho Technologies_ supplies four *indicia of effective control*, and the court quotes all four.

    - "ownership of a significant equity stake (albeit less than a majority)";

    - "the right to designate directors (albeit less than a majority)";

    - "decisional rules in governing documents that enhance the power of a minority stockholder or board-level position";~and

    - "the ability to exercise outsized influence in the board room, such as through high-status roles like CEO, Chairman, or~founder."
]

// DOC-11 and DOC-12, TM-05 sec. 1.3.
#slide[
  === Influence is additive, and three prior opinions ducked it.

  #set text(19pt)

  - Transaction-specific control asks whether the stockholder "exercise[d] actual control over the board of directors during the course of a particular~transaction." #pause

  #quote(block: true)[Rarely (if ever) will any one source of influence or indication of control, standing alone, be sufficient to make the necessary showing. Different sources of influence that would not support an inference of control if held in isolation may, in the aggregate, support an inference of control. Sources of influence and authority must be evaluated holistically, because they can be additive.] #pause

  - Three SolarCity opinions had faced the same question and none made a finding: dismissal was denied where control was "reasonably conceivable," and post-trial the transaction was held fair *even assuming* control. "This question of whether Musk controls Tesla has thus proven evasive. It is as good a time as any to run it to ground."
]

// STAT-1 and STAT-2, TM-05 sec. 1.3. The "(two-thirds)" parenthetical on Mirvis slide 6 stays
// off: SOURCE 1 says only "supermajority" and cites Tesla's Article X.
#slide[
  === What a 21.9% block actually buys.

  #set text(20pt)

  - Block size matters because turnout is not 100%. Meetings "typically attract participation from just under 80% of the outstanding shares," so Musk "will win as long as holders of approximately one-in-three shares vote the same way," while "an opponent must garner approximately 71% of the unaffiliated shares to~win." #pause

  - The supermajority bylaw runs the same way: "Musk needed the support of less than 10% of the minority stockholders to block a bylaw amendment," while "a proponent would have to garner over 93% of the unaffiliated shares to win." He did so twice, in 2014 and~2016. #pause

  - DGCL § 203 presumes control at 20% of the outstanding voting stock; the original rights plan triggered at 20%, and modern plans cap ownership at 15% or~less. #pause

  - #highlight["At a minimum, a 21.9% holding supplies a powerful 'rhetorical card[ ] to play in the boardroom.'"]
]


== Musk's Authority and the Controlled Mindset

#slide[
  === Influence over the block's vote matters more than its size.

  - The bylaw numbers show the asymmetry: a few minority holders can stop what most of them want. #pause

  #callout["Musk needed the support of less than 10% of the minority stockholders to block a bylaw amendment."]
]
