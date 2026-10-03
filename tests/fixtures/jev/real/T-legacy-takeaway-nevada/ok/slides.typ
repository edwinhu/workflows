// A #include'd file has its own scope: the master's import does not reach it, and the
// overflow and widow checkers compile this chapter through their own wrappers.
#import "../../templates/theme.typ": *

// Each act's title repeats on every slide of its run; edit it here once.
#let act1 = [Act I: _In re ZAGG_ (10th Cir. 2016).]
#let act2 = [Act II: _Chur_ (Nev. 2020).]
#let act3 = [Act III: _Guzman_ (Nev. 2021).]


= Nevada

== The Liability Floor

#slide[
  === Nevada's statutory fiduciary duties

  #set text(19pt)

  - NRS 78.138(1), as amended by AB 239: the fiduciary duties of directors and officers "are to exercise their respective powers in good faith, *on an informed basis* and with a view to the interests of the corporation." The informed-basis language is new in 2025. #pause

  - NRS 78.138(3) provides that directors and officers "are presumed to act in good faith, on an informed basis and with a view to the interests of the corporation," and a director or officer is not individually liable except as described in subsection 7. #pause

  - Subsection 3 is where Nevada's business judgment rule lives.

    - _Chur_ and _Guzman_ make the plaintiff rebut it before reaching the subsection 7 floor.
]

#slide[
  === NRS 78.138(7) is a default, not an opt-in.

  #set text(18pt)

  - Absent a charter provision imposing greater liability, a director or officer is not individually liable to the corporation, its stockholders or its creditors for damages unless:

    - "(a) The presumption established by subsection 3 has been rebutted"; and

    - "(b) It is proven that: (1) The director's or officer's act or failure to act constituted a breach of his or her fiduciary duties . . . and (2) Such breach involved *intentional misconduct, fraud or a knowing violation of law*." #pause

  - Gross negligence will not do. #pause

  - And NRS 78.138(8) applies it "to all cases, circumstances and matters," including changes of control.
]

#slide[
  === Delaware describes the Nevada floor.

  #set text(18pt)

  #quote(block: true)[
    Nevada law eliminates the individual liability of both officers and directors to the company, its stockholders or its creditors for damages as a result of a breach of fiduciary duty unless the breach involved #highlight[intentional misconduct, fraud or a knowing violation of law] and unless a company's articles of incorporation provide for greater liability.
  ]

  - The Delaware Supreme Court in _Maffei v. Palkon_, quoting the submission Nevada itself filed. #pause

  - Vice Chancellor Laster, below in the TripAdvisor litigation, put it more briefly: the litigation rights Nevada law provides shareholders "are inferably less than what Delaware provides."

  #text(
    size: 0.8em,
  )[Bloomberg Law, "Musk Gets Guidelines for Moving Tesla With TripAdvisor Opinion" (Feb. 2024).]
]

== AB 239: Controllers

#slide[
  === The 2025 amendments.

  #set text(19pt)

  - AB 239 was signed by Governor Joe Lombardo and took effect May 30, 2025. #pause

  - The bill came from the Business Law Section of the State Bar of Nevada, whose memorandum to Senate Judiciary framed the NRS 78.240 changes as a response to "the Delaware Legislature's recent push to codify in this area."
]

#slide[
  === A stockholder owes no duty, and a controller owes exactly one.

  #set text(16pt)

  - *Default rule* (NRS 78.240(2)): any holder, "regardless of the holder's relative beneficial ownership of shares or relative voting power," may "exercise or withhold the voting power of such share in the holder's personal interest and without regard to any other person or interest." And "[n]o stockholder of a corporation, in such person's capacity as a stockholder . . . shall have any fiduciary duty to the corporation or any other stockholder." #pause

  - *The single duty* (NRS 78.240(3)): the only fiduciary duty of a _controlling_ stockholder, in that capacity, "is to refrain from exerting undue influence over any director or officer . . . with the purpose and proximate effect of inducing a breach of fiduciary duty" that:

    - (a) is one "for which breach the director or officer is liable pursuant to NRS 78.138"; and

    - (b) directly relates to board action on a contract or transaction to which the controller or any of its affiliates or associates is a party, or in which the controller has a material and nonspeculative financial interest, and results in a material, nonspeculative and nonratable financial benefit to the controller, with a corresponding material detriment to the other stockholders generally. #pause

  - And exercising voting power, withholding it, or indicating how it may be exercised "does not, by itself, constitute or indicate a breach" of that duty.
]

#slide[
  === The controller duty flowchart.

  #set text(17pt)

  #align(center)[
    #set text(13pt)
    // Storytelling: the two gates sit in series, so the controller gate can never be reached
    // unless the director gate has already been cleared --- which is why proving a conflicted
    // controller, standing alone, can never produce controller liability in Nevada
    #fletcher-diagram(
      spacing: (3.2em, 2.2em),
      node-stroke: 1pt,
      node-inset: 0.5em,
      edge-stroke: 1pt,
      node(
        (0, 0),
        [*Gate 1*\ NRS 78.138(7)\ Breach involving\ intentional misconduct,\ fraud, or a knowing\ violation of law],
        shape: rect,
        name: <G1>,
      ),
      node(
        (1, 0),
        [*Gate 2*\ NRS 78.240(3)\ Controller induced\ that same breach\ by undue influence],
        shape: rect,
        name: <G2>,
      ),
      node((2, 0), [Controller\ liability], shape: rect, name: <L>),
      node((0, 1), [No liability, and\ Gate 2 never reached], shape: rect, name: <X>),
      edge(<G1>, <G2>, "-|>", label: [_cleared_]),
      edge(<G2>, <L>, "-|>", label: [_cleared_]),
      edge(<G1>, <X>, "-|>", stroke: 1pt + red, label: [_fails_], label-side: left),
    )
  ]

  - A controller cannot be liable unless a fiduciary was induced into conduct that was itself intentional misconduct, fraud, or a knowing violation of law.
]

#slide[
  === One cleansing device and a bright-line controller test.

  #set text(16pt)

  - *Safe harbor* (NRS 78.240(4)): a controlling stockholder is presumed not to have breached the subsection 3 duty if the transaction was authorized or approved by a committee of the board consisting only of disinterested directors, or by the board in reliance on such a committee. #pause

  - *Liability gate* (NRS 78.240(5)): no individual liability in the stockholder capacity unless the person is a controlling stockholder, the subsection 4 presumption has been rebutted, *and* a subsection 3 breach is proven. #pause

  - *Who counts* (NRS 78.240(6)(d)): a stockholder with the voting power "to elect at least a majority of the corporation's directors." Materially narrower than Delaware's amended § 144(e)(2). #pause

  - *Who is disinterested* (NRS 78.240(6)(e)): the term *includes* a director who neither has a material and nonspeculative financial interest in, nor is a party to, the transaction, and who would also satisfy the federal audit-committee independence standard --- Exchange Act § 10A(m), Rule 10A-3, and the listing exchange rules. Delaware's § 144(d)(2) converges on the same source. #pause

  - *What AB 239 did not codify:* unlike DGCL § 144(b)(2)--(3), there is no disinterested-stockholder-vote route and no independent fair-to-the-corporation route.
]

#slide[
  === Nevada's controller test reaches fewer holders than Delaware's.

  - Nevada counts only a holder who can elect a majority of the board; Delaware's § 144(e)(2) also counts a holder of a third of the vote with managerial control.

  - A 30% founder with board control is a controller in Delaware and a mere stockholder in Nevada.
]

