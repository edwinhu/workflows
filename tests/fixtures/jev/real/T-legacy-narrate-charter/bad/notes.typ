// Teleprompter notes for Class 1 --- Charter Competition: Delaware, Nevada, Texas
// Deck: slides/01-charter-competition.typ. Source: docs/TM-01-charter.txt.
// Bracketed [ ... ] blocks are stage directions and sourcing caveats --- not read aloud.

#set page(
  numbering: "1 of 1",
  number-align: center,
  header: text(size: 11pt)[LAW9375 --- Class 1 --- Charter Competition: Delaware, Nevada, Texas (Hu leads; Barzuza co-teaching)],
)

#set text(size: 11pt)
#set par(justify: false, leading: 0.65em)

#show link: underline

= The Controller Problem

== The Debate

=== The live controversy, as of yesterday.

- Good afternoon, and welcome to the Corporate Governance Colloquium. I am Professor Hu, and I am teaching this course with Professor Barzuza; I have today, and you will be hearing a great deal from her over the semester.

- Later in the term we will be joined by outside speakers presenting their own work in progress. For that to go well, you need a shared vocabulary and a shared set of live disputes, and building those is what today is for.

- Let me start with something that ran yesterday. Matt Levine, writing in _Money Stuff_ on August 24, 2026, under the headline "Money Stuff: Who Should Control Anthropic?"

- His line was this: "They shouldn't be controlled by shareholders _or_ by founders. They should be controlled by a wise body of philosophers with no economic stakes, whose only goal is maximizing the benefit of AI for humanity."

- That is a joke, and it is also the whole course. Somebody controls the corporation, and every legal regime we will study is an answer to what the law does about the person who does.

- You have all had Corporations, so you already know the doctrinal machinery. What I want to add this semester is the jurisdictional question that sits underneath it: which state's machinery, and who chose it.

=== Where we are starting, and why.

- One of the most contested questions in American corporate law today is what happens when the person on both sides of a deal already controls the votes.

- For forty years Delaware answered that question with a standard --- entire fairness --- policed case by case by a court of equity.

- In 2025 three legislatures answered it with rules instead: Delaware SB 21, Nevada AB 239, and Texas SB 29.

- The motives were opposite. Delaware moved to pre-empt the departure of high-profile controlled companies like Tesla; Nevada and Texas moved to attract exactly those companies.

- So today we do two things. First we review the doctrine the statutes were written against, and then we read the statutes as answers to it.

- A word on how this room works. I will lecture less than you are used to and ask more, and when I put a question on the screen I actually want an answer, not silence I eventually fill.

=== Recall the challenges with freeze-outs.

- Let me put the structural problem back in front of you, because everything else today is a response to it.

- A controlling stockholder owns more than half of the target's stock. The minority holds the rest, and the controller also owns the merger subsidiary that is buying them out.

- So in a freeze-out merger the controller sits on both sides of the transaction. The price the minority receives is set, on both sides, by the buyer's own agent.

- The ordinary arm's-length assumption fails there, and the controller has an incentive to lowball. That single fact is what generates entire fairness. TM § 1.1.

- The same structure recurs in weaker form whenever a controller extracts a benefit not shared ratably --- a tax-sharing agreement, a related-party services contract, a compensation grant to a controller who is also an officer.

- Hold onto that last example. It is the one that turns into Tesla.

== From Standard to Statute

=== _Weinberger_ (1983): fair dealing and fair price, judged as a whole.

- Start with _Weinberger v. UOP, Inc._, 457 A.2d 701 (Del. 1983), the case that set the standard everything since has argued about.

- Signal owned 50.5% of UOP and wanted the remaining 49.5%. Two UOP directors who were also Signal officers --- Arledge and Chitiea --- used UOP data to conclude that acquiring the minority at any price up to \$24 would be a good investment for Signal.

- That study went to the Signal board. It did not go to UOP's outside directors and it did not go to the minority. Signal offered \$21. 457 A.2d at 705--09.

- The Court held that entire fairness has two halves, fair dealing and fair price, and that they are not weighed separately --- the transaction is examined as a whole. _Id._ at 711.

- Then comes footnote 7, which is the sentence the last forty years of practice were built on. I want to read it exactly.

- "[T]he result here could have been entirely different if UOP had appointed an independent negotiating committee of its outside directors to deal with Signal at arm's length . . . . [A] showing that the action taken was as though each of the contending parties had in fact exerted its bargaining power against the other at arm's length is strong evidence that the transaction meets the test of fairness." 457 A.2d at 709--11 & n.7.

- Notice what that is. It is a court telling planners how to build a process that will survive review, and the entire special-committee industry is the answer to that invitation.

- One more piece worth carrying: _Weinberger_ also made appraisal ordinarily the exclusive remedy for a minority stockholder complaining only of price, absent fraud, misrepresentation, self-dealing, deliberate waste or gross overreaching. _Id._ at 714. That carve-out is what kept the fiduciary action alive alongside appraisal, and it will matter when we get to Nevada.

=== _Kahn v. Lynch_ (1994): the protections moved the burden, not the standard.

- Eleven years later the Court answered the obvious follow-up question: if you build the committee footnote 7 described, what do you get for it?

- _Kahn v. Lynch Communication Systems, Inc._, 638 A.2d 1110 (Del. 1994). Alcatel held 43.3% of Lynch --- less than a majority --- and the courts still treated it as a controller because it exercised actual control over the business. _Id._ at 1113--15.

- Keep that number. 43.3% is the fact that a bright-line statutory definition has to decide what to do with, and we will come back to it this afternoon.

- The holding: entire fairness governs a controller freeze-out even where an independent special committee negotiated the deal. The protections do not change the standard.

- What they can do is shift the burden of persuasion to the plaintiff, through either a properly functioning special committee of independent directors with real power to say no, or approval by an informed majority of the minority. _Id._ at 1117.

- On the facts the committee failed. Alcatel had threatened a hostile tender offer at a lower price, so the committee's "no" was not credible and the burden stayed with the defendants. _Id._ at 1121--22.

- Now the litigation consequence, which is the point SB 21's proponents pressed hardest. Because entire fairness is a standard applied on a full record, a complaint against a controller deal could rarely be dismissed on the pleadings.

- So nearly every case settled or went to trial on fairness. That is a practitioner-consensus proposition rather than a holding --- it is asserted, for instance, in Morris Nichols, "Thirty Years Later --- Why Companies Continue to Choose Delaware" (2025). TM § 1.4.

=== _MFW_ (2014): both protections, adopted up front, buy business judgment.

- Twenty years after _Lynch_, Delaware finally offered a controller a way out of entire fairness altogether. _Kahn v. M&F Worldwide Corp._, 88 A.3d 635 (Del. 2014).

- Business judgment review applies to a controller buyout if and only if six conditions are met, and all six are required. 88 A.3d at 645.

- One: the controller conditions the transaction, up front, on approval by both a special committee and a majority of the minority. Two: the committee is independent. Three: it is empowered to select its own advisors and to say no definitively.

- Four: the committee meets its duty of care in negotiating price. Five: the minority vote is informed. Six: the minority is uncoerced. Fail any one and entire fairness returns.

- Then the timing rule, which is the piece to watch today. The dual conditions must be in place _ab initio_.

- _Flood v. Synutra International, Inc._, 195 A.3d 754, 756, 763 (Del. 2018), construed that to mean the conditions must be imposed before substantive economic negotiations begin --- not necessarily in the controller's very first written overture.

- Ten years after _MFW_, the Court extended the framework. _In re Match Group, Inc. Derivative Litigation_, 315 A.3d 446 (Del. 2024), held that the _MFW_ framework governs all controller transactions conferring a non-ratable benefit, not just freeze-outs. _Id._ at 454--66.

- _Match_ also held that a special committee must be composed entirely of disinterested and independent directors, so a single conflicted member disables the committee. _Id._ at 467--69.

- _Match_ came down in April 2024. Ten months later Delaware introduced a bill written to overrule it. That sequence is the rest of the class.

== Why Delaware Moved

=== The complaint behind SB 21 was primarily about litigation risk.

- So what exactly was the complaint? It helps to separate the objection to outcomes from the objection to process, because the bill's defenders made the second one.

- Entire fairness is a standard, not a rule. Whether a director was "independent," or whether a 25% holder was a "controller," got decided after the fact on a full record.

- And under _Lynch_, controller status could attach well below 50% on findings of actual control. Alcatel at 43.3% is the canonical example, so planners could not tell in advance which regime applied.

- Meanwhile books and records under DGCL § 220 had become a pre-suit discovery tool. Emails, texts and informal board communications were producible, and they made complaints that survived dismissal.

- Complaints that survive dismissal against a controller command settlement value whether or not they are meritorious. That is the grievance, stated at its strongest.

- Larry Hamermesh, who helped draft the bill, put the diagnosis this way in the _New York Times Magazine_ in June 2026 --- he personally thought Chancellor McCormick decided _Tornetta_ correctly, but there was "a perception that the litigation environment here is toxic, particularly for controlling shareholders." TM § 10.3.

=== And a drafting question that decided the shape of § 144.

- Underneath the politics there was a genuine drafting question, and it decided the architecture of the statute.

- One cleansing device, or two? For a decision that needs no shareholder vote --- executive compensation being the case that actually mattered --- the choice between § 144(b) and § 144(c) is the entire design.

- If you require both a committee and a majority-of-the-minority vote, then a compensation grant at a controlled company is effectively unfixable without going to the stockholders every time.

- The case that made this concrete is _Tornetta v. Musk_, 310 A.3d 430 (Del. Ch. 2024). Chancellor McCormick held Musk was a controlling stockholder as to the 2018 option grant, that entire fairness applied and was not met, and rescinded the award --- worth roughly \$55.8 billion at the time.

- Two findings carried the fair-dealing half: one director testified he did not view the negotiation as an adversarial process, and another's admiration for Musk moved him to tears during his deposition. TM § 4.1.

- Tesla reincorporated in Texas that same year. The Delaware Supreme Court reversed the remedy on December 19, 2025, in _In re Tesla, Inc. Derivative Litigation_ --- long after the exodus had begun.

- Read the reversal narrowly, because the deck compresses it. The Court held rescission was an improper remedy, reinstated the 2018 package, and awarded \$1 in nominal damages.

- On fees it adopted the defendants' own proposal --- lodestar with a four-times multiplier --- cutting the \$345 million award to \$54.5 million.

- And here is what it did not do. It expressly did not decide whether the plan was entirely fair, and it did not decide whether the June 2024 stockholder vote ratified it. TM § 4.3.

- So the chronology is the argument. Chancery rescinds in January 2024; Tesla leaves in 2024; Delaware legislates in March 2025; the Supreme Court reverses in December 2025. Delaware legislated nine months before its own high court cleaned up the case.

=== The pressure on Delaware was political as well as doctrinal.

- The pressure was not only doctrinal, and I want to be honest that it was also personal.

- On January 30, 2024 --- the same day Chancellor McCormick rescinded the award --- Musk posted on X: "Never incorporate your company in the state of Delaware."

- That post is at x.com slash elonmusk slash status slash 1752455348106166598, and I have linked it on the slide.

- He is also reported to have said, three days later, "She has done more to damage Delaware than any judge in modern history," and to have described the Chancellor around the same period as an "activist and politician, first and foremost."

  - [SOURCING: the TM flags both of those follow-on lines as UNVERIFIED --- the underlying posts were not retrieved. Say "reported"; do not present them as confirmed quotations. TM § 10.2.]

- Here is the question the slide asks, and I want an answer before we move on. Does charter competition discipline courts, or expose them?

  - [Discussion map. The disciplining story: an unreviewable court with a captive tax base has no feedback loop, and exit supplies one. The exposing story: the pressure came from a single litigant who lost, so what got disciplined was a correct decision. Push on who is exerting the pressure --- a controller, not the diversified shareholders whose money is at stake.]

  - [If someone raises judicial elections, that is the right instinct: hold it for Nevada, where AJR 8 would create appointed judges in a state that elects everyone else.]

=== Delaware's exposure is fiscal, and it is unusually concentrated.

- Now the fiscal picture, because Delaware's reaction only makes sense if you see how concentrated its exposure is.

- Franchise taxes and related fees supply over 20% of Delaware's state budget. That is the conservative version of the figure; Morris Nichols puts it at approximately one-third of general revenue, and CNBC at more than a quarter.

- The deck also carries a companion claim that law-firm wage taxes supply roughly 40% of Wilmington's budget. I will flag that one as a figure in circulation that I have not been able to source.

  - [UNVERIFIED per TM § 3.8. Either attribute it or drop it if pressed; do not defend the number.]

- Wilson Sonsini was reported in early 2025 to have counted fifteen significant companies actively considering reincorporation. That report is widely repeated, and I could not locate the underlying statement, so take it as an indication of temperature rather than a count.

  - [UNVERIFIED per TM § 3.8.]

- The institutional opposition is confirmed and it was serious. The Council of Institutional Investors, whose members manage roughly \$5 trillion, filed a letter opposing the bill --- objecting as much to the process as to the substance, calling the drafting a stark deviation from Delaware's multi-stakeholder practice.

- The International Corporate Governance Network also filed in opposition. The \$90 trillion figure for ICGN members is the one ICGN itself has used, but it was not confirmed against ICGN's materials, so I will attribute it rather than assert it.

  - [UNVERIFIED per TM § 3.8.]

- Also opposing: New York State Comptroller DiNapoli, CalPERS, and a joint letter signed by more than forty-five public pension and Taft-Hartley funds.

- Robert Jackson, the former SEC Commissioner, testified that "investors' reactions to SB 21 have been surprisingly negative," and his testimony was cut off by the House Speaker. Reuters, March 25, 2025. TM § 3.8.

- And the precedent everyone reached for is New Jersey in 1913 --- New Jersey passed antitrust legislation that angered business, and Delaware took the business New Jersey had made unwelcome.

- That analogy cuts both ways, and I would like someone to tell me which way. It says jurisdictions that displease business lose it; it also says the winner of that exchange was the jurisdiction that offered greater leniency.

=== And the lobbying was not only Musk's.

- It is tempting to tell this as a story about one litigant, so let me complicate it.

- CNBC reported on March 19, 2025, under the headline "Meta's potential exit from Delaware had governor worried enough to call special weekend meetings."

- The lead reads: "As Delaware lawmakers debate a bill that could dramatically alter the state's corporate law, Meta and CEO Mark Zuckerberg have a lot at stake in the outcome."

- The sequence matters. News broke in late January 2025 that Meta might leave; Governor Meyer invited Meta's corporate secretary and policy officials to meet in February; SB 21 was introduced February 17.

- Meta was itself the subject of § 220 investigations, and under the February 17 cutoff, claims filed after that date would be judged under the new law. TM § 10.2.

- So ask yourself what it means that the effective date of a retroactive statute lands on the day it was introduced, in the same month the state's governor was holding weekend meetings with one company.

= Delaware's Answer

== Three Regimes for One Problem

=== Section 144 now sorts controller deals by type.

- The table on this slide lays out the three regimes side by side, so look at the left column first.

- Ordinary controller transactions need one cleansing step; going-private transactions need both.
