# Diagnosing a rule that does not calibrate

Read the failing row of `rule-calibrate`, then dump the state Jev received before changing anything
(`extractor.md` last section). Every row below is a measured incident from the 2026-10-02 rule sets.

| # | Symptom | Incident (numbers) | Cause | Fix |
|---|---|---|---|---|
| 1 | Violating twin 0.5–0.8, compliant low | MOCK 0.51 → 0.92; A1 0.61/0.71 → 0.93/0.94; S-SETUP 0.78/0.77 → 0.93/0.94 | vague or negation-heavy question; the state lacks the field the claim needs | reword to one positive per-site claim naming the state field; add the field (`proposition.md`) |
| 2 | Nothing separates; scores look like guesses | ds: 9 of 10 rules unwired (213223f6); old A1 state was one comment match, 0.87/0.84 then 0.80/0.88 | whole-file text or raw regex hits over comments and docstrings | inventory + decisive count per rule (e9c530ea, 15f5e3fb) |
| 3 | Violating twin reads NOT_APPLICABLE (≈ 0.00) | DEN, R1, UNI, DQ4, DQ6, E7 old `vio` had zero sites; A4 `vio` no estimates; M1 `vio` no plan | inverted or empty fixture | corrected NEW `vio2`/`sat2` beside the old pair; never edit the old |
| 4 | Accepted legacy code scores high | DQ4/DQ6 0.94–1.0 on 4 of 7 accepted scripts | the state shows legacy transforms the change never touched | take `changed`; legacy-base ok/bad pairs: bad 1.00, ok 0.00 (9dd3be43) |
| 5 | Accepted work really breaks the written rule | T-CALLOUT: Tornetta 0.94–0.97, landscape 0.99 (accepted decks quote in callouts); N-UNCITED: lecture 14 0.89–0.94, 208 of 221 blocks uncited | the rule is not the accepted practice | user decides; if new work must follow it, changed lines + legacy-base pairs (T-CALLOUT, T-STORY 398755fb; N-UNCITED e80aa86) |
| 6 | Twin never reaches 0.85 whatever the wording; or accepted work keeps failing after narrowing | T-ECHO 0.75–0.79, then 0.51–0.59; T-TRANSITION charter 0.67–0.77; T-NARRATE charter 0.87–0.91; narrowing the state to the added span fixed none (2242d11d) | the judgement is past what Jev decides from a bounded state — or the extractor's own cue list already decides it | if the cues that select the spans ARE the rule, it is a script: T-NARRATE's Texas notes held 0.50–0.61 over seven invocations, a screen-phrase lexicon (workshop `NAR`) separates every case of its set; otherwise park in `uncalibrated/` with the numbers in the docstring |
| 7 | Real compliant case scores high because the rule and its source disagree | EX-SENTINEL: slate rules call sentinels legitimate, twin 0.56–0.61; A-PAD 0.61–0.68 on accepted State Files doctrine; L-SUPRA Mirror 0.58–0.68 | the proposition contradicts the source, or omits an exemption the source grants | ask; record the ruling: A-PAD named the fact-row exemption, 0.21–0.31, wired (c198083f); L-SUPRA ruled (be1722a2), then Bluebook 4.2's letter on Federal Register releases with OPV relabelled violating plus a cured twin (8fd4cf22); EX-SENTINEL ruled against the rule and retired (2026-10-02) |
| 8 | A real case scores high on a span that is fine | Mirror excerpt from line 31: 11 of 26 supra sites resolved to the wrong note; L-ID splitter broke on initials, OPV 0.73/0.67 → 0.10 | extractor resolution bug | fix the extractor; re-cut the excerpt from line 1 (`extractor.md`) |
| 9 | Cross-rule hit | N-HOLLOW 0.94 on N-COLD's twin; E-CAUSAL 0.70 on E-WEFIND's twin; DQ4 ↔ DQ6 on every unlogged transform | the twin breaks a second rule by accident, or one defect breaks two rules by definition | rewrite the accidental construct in the twin; accept the definitional pair (`--accept-cross`) |
| 10 | Passes at the bar | T-STORY charter/bad 0.84–0.89; T-TAKEAWAY 0.41–0.61 over 8 runs; L-FNARG Mirror 0.42/0.48 | two runs of one invocation differed by up to 0.14 (T-TAKEAWAY 0.47/0.61); or the state hands the judge context that answers the question for the span (T-STORY's diagram labels carried the insight the comment omitted) | withhold the answering context and give closed-list flags: T-STORY 0.99–1.00 (b3db6917); T-TAKEAWAY 0.38–0.86 → 0.93–0.98 once the slide body left its state; third invocation within 0.03 of a bar; a pass inside a failing history stays parked |
| 11 | Real case scores 0.00 everywhere | T-HOLLOW real notes after its precision fix yielded zero candidates | vacuous case: the excerpt lacks the construct | replace it with an excerpt that contains the construct done right |
| 12 | Someone proposes another backend | strands-decider v19: 0 of 18 rules separate, p in 0.17–0.83, margin +0.105 vs Jev +0.564, 0.59 s vs 0.49 s | a 2B local decider does not separate | stay on Jev; rerun the 18-rule comparison before any backend change |

## Order of moves

1. Dump the state (`extractor.md`). If the field the proposition needs is missing or wrong, it is row 2, 3 or 8.
2. If the twin is right and the state is right, reword once (row 1).
3. If accepted work fires, decide between rows 4, 5 and 7 by reading the accepted span: legacy that new
   work must not repeat (4/5), or a rule that is wrong about it (7). Rows 5 and 7 need the user.
4. Two rounds failed after that → row 6: park.
