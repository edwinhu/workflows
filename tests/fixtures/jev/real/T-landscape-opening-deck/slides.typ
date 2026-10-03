#import "../../templates/theme.typ": *
#show: preview-preamble.with(title: [The Corporate Governance Landscape])

= The Corporate Governance Landscape

== Corporation, Corporate Law, Corporate Governance

#slide[
=== What is a corporation?

- A corporation is a *legal* thing designed to facilitate a *voluntary economic* thing --- people choosing to organize production together. #pause

- The legal thing has five core structural characteristics: legal personality, limited liability, transferable shares, centralized management under a board, and shared ownership by the contributors of equity capital. #pause

- Everywhere that matters economically, "there is a basic statute that provides for the formation of firms with all of these characteristics." #pause

- They are complementary: "together, they make the corporation especially attractive for organizing productive activity." #pause

- But they also "generate tensions and tradeoffs that lend a distinctively corporate character to the agency problems that corporate law must address."

#text(size: 0.8em)[Kraakman et al., _The Anatomy of Corporate Law_ §1.2 (3d ed. 2017).]
]

#slide[
=== What is corporate law? Less of a command than you would think.

- In Corporations we talk almost entirely about *law* --- the DGCL, _Van Gorkom_, _Unocal_, _Caremark_ --- as though governance were what the Chancery Court says it is. #pause

- Rock and Wachter: inside the firm, governance runs primarily through "norms" --- "nonlegally enforceable rules and standards" ("NLERS"). #pause

- Stronger than it sounds: "the raison d'etre of firms is to replace legal governance of relations with nonlegally enforceable governance mechanisms." #pause

- So corporate law is not mainly a set of commands. It "emerges as a remarkably sophisticated mechanism for facilitating self-governance by NLERS." #pause

- A law that mostly facilitates, though, leaves open the question of who protects the people who never got to bargain.

#text(size: 0.8em)[Edward B. Rock & Michael L. Wachter, _Islands of Conscious Power_, 149 U. Pa. L. Rev. 1619, 1622--23 (2001).]
]

#slide[
=== And it leaves the people who never bargained exposed.

- Clark: stage one's protections were individual chartering, sharp limits on corporate powers and "personality," and antitrust --- the first two abandoned by 1900. #pause

- What was left set "rules of fair play" among entrepreneurs treated as one peer group, with reasonably good information and "a realistic ability" to bargain. #pause

- *Public investors were never in that peer group.* So the law added market facilitation, disclosure, and "externally imposed --- and frequently nonnegotiable --- fiduciary duties." #pause

- *And limited liability pushes the downside outward.* Critics called it a "subsidy," asking whether it would "just impose the risk of doing business on suppliers, customers, and lenders." #pause

- Those two gaps are where the conflicts come from --- owners v. managers, controlling v. minority owners, and the firm v. the creditors, workers and consumers it may expropriate.

#text(size: 0.8em)[Clark, 94 Harv. L. Rev. at 569--71; Micklethwait & Wooldridge, _The Company_ xvii, 50; Kraakman et al., _Anatomy_ 29--30.]
]

#slide[
=== What is corporate governance? A machine with three components.

#align(center)[
  #fletcher-diagram(
    node-stroke: 1pt,
    edge-stroke: 1pt,
    spacing: (1.5em, 1.1em),
    node-inset: 0.25em,

    node((0, 0), [*Law*\ Delaware, Congress,\ SEC, DOL], name: <law>, fill: rgb("#b8c9e8")),
    node((0, 1), [*Institutions*\ investors, associations,\ proxy advisors, exchanges,\ indices, ratings agencies], name: <inst>, fill: rgb("#c8e6c9")),
    node((0, 2), [*Culture*\ education, media,\ politics], name: <cult>, fill: rgb("#ffe0b2")),
    node((1, 1), [*The public*\ *corporation*], name: <corp>, fill: rgb("#ffcdd2")),
    node((2, 1), [*Shareholder*\ *interests*], name: <sh>, fill: rgb("#b8c9e8")),

    edge(<law>, <corp>, "-|>"),
    edge(<inst>, <corp>, "-|>"),
    edge(<cult>, <corp>, "-|>"),
    edge(<corp>, <sh>, "-|>", label: text(size: 0.85em)[oriented toward], label-side: left, label-sep: 1.9em),
  )
]

- Law is one input of three. No component has to be decisive, because each reinforces the others --- which is also why changing one alone tends not to work.

#text(size: 0.8em)[Lund & Pollman, 121 Colum. L. Rev. at 2572--73, 2578--2609.]
]

== What Is a Firm For?

#slide[
=== Why is there any organization at all, rather than just prices?

- Coase, quoting D.H. Robertson: we find "islands of conscious power in this ocean of unconscious co-operation," "like lumps of butter coagulating in a~pail~of~buttermilk." #pause

- Then the question that started the literature: "in view of the fact that it is usually argued that co-ordination will be done by the price mechanism, why is such organization necessary?" #pause

- Everything since is an attempted answer. A theory of the firm describes "why we have firms, what goes on inside firms, and what are the boundaries of the firm." #pause

- And it tells a lawyer which problems the parties can solve themselves, and "the role the law plays in facilitating or interfering with solutions."

#text(size: 0.8em)[Rock & Wachter, 149 U. Pa. L. Rev. at 1621--22, quoting Coase, _The Nature of the Firm_ (1937).]
]

#slide[
=== Economics offers four answers, and you have to pick one.

- *Nexus of contracts.* The firm as the sum of its bargains --- which leaves it "without a core and without 'insiders,'" and "uninformative as to the corporation's economic function." #pause

- *Transaction cost and property rights,* "a single theory" for Rock and Wachter: high transaction costs pull a relationship inside a hierarchy; owning the assets carries residual control. #pause

- *Ownership costs.* Hansmann: control plus residual earnings, assigned so that it "minimizes the sum" of contracting and ownership costs. #pause

- *Team production.* Blair and Stout: the board mediates among all who invest --- next slide. A menu, not a ranking.

#text(size: 0.8em)[Rock & Wachter at 1626--40; Henry Hansmann, _The Ownership of Enterprise_ 11, 21--22, 35 (2000).]
]

#slide[
=== Whose claim on the board is different in kind?

- Rock and Wachter put it flatly: are dispersed shareholders "just one stakeholder among many, with no greater ownership claims than, say, the creditors~or~the~employees?" #pause

- Blair and Stout, as they report it: the board is a "mediating hierarchy," an "honest broker," with shareholders "merely one of many groups of stakeholders." #pause

- Their reply: shareholders hold "ownership-type claims not available to any of the stakeholders that contract with the firm," and can "throw them out." #pause

- "That is why only shareholders get to vote for directors" --- the feature "that fixes the goals of the board's exercise of discretion." #pause

- We have Blair and Stout only as Rock and Wachter describe them.

#text(size: 0.8em)[Rock & Wachter, 149 U. Pa. L. Rev. at 1658.]
]

== Clark's Four Stages: Who Owns, Which Conflict

#slide[
=== Ask these two questions of every arrangement we meet.

- Most commentators see no long-term pattern in how capital is aggregated. Clark says there is one, and it runs in four stages. #pause

- At each stage a role splits in two, and the professionalized half takes over a decision the other half used to make. #pause

- So each stage leaves a different answer to two questions we will return to~all~semester: #pause

  - *By whom* is the corporation managed? #pause

  - *For whom?*

#text(size: 0.8em)[Robert Charles Clark, _The Four Stages of Capitalism_, 94 Harv. L. Rev. 561, 561--62 (1981).]
]
