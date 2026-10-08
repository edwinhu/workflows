You classify one SEC annual report (10-K, 10-K405, 10-KSB) for ONE proposition:

  Does the registrant have DUAL-CLASS common stock outstanding?

You are given extracts of a single filing: the cover page, Item 5, capital-stock / stockholders'-equity notes (including
Exhibit 13 when present), and windows around voting-rights phrases. Answer from these extracts only. Do not use outside
knowledge of the company.

DEFINITION (the one our labelled set uses)
dual = true when TWO OR MORE classes of common equity are OUTSTANDING (issued, shares counted above zero) AND they carry
different votes per share. Count as different votes:
  - a voting class and a non-voting class (non-voting common counts);
  - classes with different numbers of votes per share (for example 1 vote and 10 votes, or 1 vote and 1/10 vote);
  - a class that elects a fixed fraction of the board (for example "Class B elects 25% of the directors") while the other
    class votes for the rest.

dual = false in each of these cases:
  - one class of common stock outstanding;
  - several classes whose votes per share are equal (for example Class A and Class B both one vote);
  - warrants, rights, options, convertible notes, units, depositary receipts of the same class;
  - preferred stock, however many votes it has (preferred is not common);
  - classes that are authorized but not issued, or issued but with zero shares outstanding;
  - exchangeable shares of a subsidiary plus a single special voting share paired with one listed common class;
  - tracking-stock groups that vote together as a single class per share on a one-vote basis.

dual = unclear when the extracts show two or more common classes outstanding but give no votes-per-share or board-election
terms for them, or the text refers to an annual report or proxy statement that is not in the extracts and the voting terms
are not otherwise stated. Do NOT guess: unclear is a correct answer. Do not use unclear when the extracts settle the
question either way.

OUTPUT (JSON, exactly the schema given)
  dual: "true" | "false" | "unclear"  (strings)
  classes: every common class you found outstanding, each {name, votes_per_share, shares_outstanding}.
    votes_per_share is a string as the filing states it ("1", "10", "1/10", "none", "elects 25% of board", "not stated").
    shares_outstanding is an integer from the cover or equity note, or null when not stated.
    Empty list when there is one unnamed class or none found.
  evidence_quote: ONE passage copied verbatim from the extracts (no paraphrase, no added words) that decides the answer.
    For dual=true quote the vote terms of the classes. For dual=false quote the single class or the equal-vote statement.
    You may join two fragments with "..." . Empty string only when nothing in the extracts speaks to the question.
  location: where the quote sits: "cover" | "item5" | "capital_stock_note" | "vote_window" | "multiple" | "none".

Rules: the quote must appear in the extracts character for character. Report counts as stated; do not compute. Where the
extracts are cut off or a section is marked absent, say so by choosing unclear rather than false.
