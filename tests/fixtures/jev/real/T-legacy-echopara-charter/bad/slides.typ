#import "../templates/theme.typ": *

#show: university-theme.with(
  aspect-ratio: "16-9",
  config-info(
    title: [Charter Competition --- Delaware],
    subtitle: [LAW9375],
    author: [Michal Barzuza & Edwin Hu],
    date: datetime.today(),
    institution: [UVA School of Law],
    logo: image("../assets/LawP_horizontal_short_4c_RGB.png"),
    qr: none,
  ),
)

#show link: underline
#set list(marker: ([•], [--]))

#show quote.where(block: true): block.with(stroke: (left: 2pt + gray, rest: none), above: 1.5em)

#set heading(numbering: numbly(
  "{1}.",
  "{1}.{2}.",
  "{3}.",
))

#show selector(heading.where(level: 3)): set heading(numbering: none)
#show selector(heading.where(level: 4)): set heading(numbering: none)

#title-slide()

= The Controller Problem

== The Debate

#slide[
  === The live controversy, as of yesterday.

  #headline-card(
    venue: "Money Stuff",
    date: "Aug. 24, 2026",
    headline: "Money Stuff: Who Should Control Anthropic?",
    phrase: "Who Should Control Anthropic?",
    quote: [They shouldn’t be controlled by shareholders _or_ by founders. They should be controlled by a wise body of philosophers with no economic stakes, whose only goal is maximizing the benefit of AI for humanity.],
    logo: "../assets/logos/bloomberg.svg",
    compact: true,
  )

  #text(size: 0.8em)[Matt Levine, _Money Stuff_, Bloomberg Opinion, Aug. 24, 2026.]
]

#slide[
  === Where we are starting, and why.

  - One of the most contested questions in American corporate law today is what happens when the person on both sides of a deal already controls the votes. #pause

  - For forty years Delaware answered that question with a *standard* --- entire fairness --- policed case by case by a court of equity. #pause

  - In 2025 three legislatures answered it with *rules*: Delaware SB 21, Nevada AB 239, Texas SB 29. #pause

  - Tesla had already gone to Texas a year before SB 21 was introduced. Delaware moved to hold the companies that might follow --- word that Meta could leave brought the governor to weekend meetings. Nevada and Texas moved to~try~and~attract~them. #pause

  - Today we will review the doctrine the statutes were written against.
]

#slide[
  === Recall the challenges with freeze-outs.

  #set text(18pt)
  #align(center)[
    // Storytelling: the controller sits above both merger parties → the price the minority receives is set by the buyer's own agent, which is why fairness cannot be presumed
    #fletcher-diagram(
      spacing: (5em, 2.6em),
      node-stroke: 1pt,
      node-inset: 0.5em,
      edge-stroke: 1pt,
      node(
        (0, 0),
        [Controlling Stockholder\ of Corporation T\ #emoji.person.crown],
        shape: rect,
        name: <CS>,
      ),
      node((0, 1), [Corporation T], shape: rect, name: <T>),
      node((0, 2), [Minority Stockholders\ of Corporation T\ #emoji.ant], shape: rect, name: <MS>),
      node((2, 0), [Merger Sub\ #emoji.money], shape: rect, name: <DC>),
      edge(<CS>, <T>, "-|>", label: [_> 50% of\ T stock_], label-side: left),
      edge(<MS>, <T>, "-|>", label: [_< 50% of\ T stock_], label-side: left),
      edge(<CS>, <DC>, "-|>"),
      edge(
        <DC>,
        <T.east>,
        "<|-|>",
        stroke: 1pt + red,
        label: [_"Freeze-Out"\ Merger_],
        label-side: left,
        label-angle: auto,
      ),
    )
  ]

  - Both sides of the transaction answer to the same person, and the controller has incentives to lowball the minority.
]

== From Standard to Statute

#slide[
  === _Weinberger_ (1983): fair dealing and fair price, judged as a whole.

  #set text(20pt)

  - Signal owned 50.5% of UOP. Two UOP directors who were also Signal officers used UOP data to conclude that buying the minority at any price up to \$24 would be a good investment *for Signal* --- a study given to Signal's board, and not to UOP's outside directors or the minority. Signal offered \$21.

  - Entire fairness has two halves: *fair dealing* and *fair price*. They are not weighed separately --- the court examines the transaction as a whole.

  #quote(block: true)[
    [T]he result here could have been entirely different if UOP had appointed an independent negotiating committee of its outside directors to deal with Signal at arm's length . . . . [A] showing that the action taken was as though each of the contending parties had in fact #highlight[exerted its bargaining power against the other at arm's length] is strong evidence that the transaction meets the test of fairness.
  ]

  #text(size: 0.8em)[_Weinberger v. UOP, Inc._, 457 A.2d 701, 709--11 & n.7 (Del. 1983).]
]

#slide[
  === _Kahn v. Lynch_ (1994): the protections moved the burden, not the standard.

  #set text(20pt)

  - Entire fairness governed a controller freeze-out even where a special committee negotiated the deal. #pause

  - Burden of persuasion could shift to the plaintiff through *either*:

    - a properly functioning special committee of independent directors with real power to say no; *or*

    - approval by a majority of the minority. #pause

  - Consequence, as practitioners describe it: because fairness is judged on a full record, a complaint against a controller deal could rarely be dismissed on the pleadings, so nearly every case settled or went to trial.

  #text(size: 0.8em)[_Kahn v. Lynch Communication Systems, Inc._, 638 A.2d 1110 (Del. 1994).]
]

#slide[
  === _MFW_ (2014): both protections, adopted up front, buy business judgment.

  #set text(20pt)

  - Six conditions, all required:

    - (i) controller conditions the deal on *both* special committee and majority-of-the-minority approval;

    - (ii) the committee is independent, and (iii) free to hire its own advisors and to say no;

    - (iv) the committee meets its duty of care; (v) the minority vote is informed; (vi) the minority is uncoerced. #pause

  - The *dual conditions* --- (i) --- must be in place _ab initio_: imposed before substantive economic negotiations begin. #pause

  - _In re Match Group_ (Del. 2024) then extended the framework to *all* controller transactions conferring a non-ratable benefit, not just freeze-outs.

  #text(
    size: 0.8em,
  )[_Kahn v. M&F Worldwide Corp._, 88 A.3d 635 (Del. 2014); _In re Match Group_, 315 A.3d 446 (Del. 2024).]
]

== Why Delaware Moved

#slide[
  === The complaint behind SB 21 was primarily about litigation risk.

  #set text(20pt)

  - Entire fairness is a *standard*, not a rule. Whether a director was "independent," or a sub-majority holder a "controller," was decided ex post, on a full record. #pause

  - Controller status could attach well below 50% on findings of actual control --- so planners could not tell in advance which regime applied. #pause

  - Books and records under § 220 had become a pre-suit discovery tool, and the resulting complaints survived dismissal often enough to command settlement value. #pause

]

#slide[
  === And a drafting question that decided the shape of § 144.

  #set text(20pt)

  - *One* cleansing device, or *two*? § 144 draws that line at going-private: § 144(c) for freeze-outs, § 144(b) for every other controller deal. Where the line falls is the whole design. #pause

  - _Tornetta v. Musk_ (Del. Ch. 2024) rescinded Musk's Tesla award, worth roughly \$55.8 billion at the time of the decision --- and Tesla reincorporated in Texas that year. The Delaware Supreme Court reversed that remedy on Dec. 19, 2025, long~after~the~exodus~had~begun.

  #text(size: 0.8em)[_Tornetta v. Musk_, 310 A.3d 430 (Del. Ch. 2024), _rev'd sub nom. In re Tesla, Inc. Derivative Litigation_, 2025 WL 3689114 (Del. Dec. 19, 2025) (No. 534, 2024) (en banc) (per curiam): rescission was an improper remedy and the fee award was cut --- but the Court did not reach entire fairness or ratification.]
]

#slide[
  === The pressure on Delaware was political as well as doctrinal.

  #headline-card(
    venue: "X",
    handle: "@elonmusk",
    date: "Jan. 30, 2024",
    headline: [Never incorporate your company in the state\u{00A0}of\u{00A0}Delaware],
    logo: "../assets/logos/x.svg",
  )

  #text(
    size: 0.8em,
  )[Posted the day Chancellor McCormick rescinded the Tesla award (#link("https://x.com/elonmusk/status/1752455348106166598")[x.com/elonmusk/status/1752455348106166598]). Posts attacking the Chancellor personally followed over the next days. Does charter competition discipline courts, or expose~them?]
]

#slide[
  === Delaware's exposure is fiscal, and it is unusually concentrated.

  #set text(20pt)

  - Franchise taxes and related fees supply over 20% of Delaware's state budget --- Morris Nichols puts it nearer a third; CNBC, at more than a quarter. #pause

#slide[
  === Delaware now asks less of a controller who wants out of entire fairness.

  #set text(20pt)

  - The statutory route away from the strictest review has become easier for a dominant holder to take. #pause

  - Going-private deals still need both a committee and a vote.
]
