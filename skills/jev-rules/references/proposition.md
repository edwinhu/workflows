# The proposition — one checkable claim, YES = VIOLATED

`rule-check.ts` asks Jev one `choice` question per rule: "Decide whether this is true of the state
below (rule <ID>): <PROPOSITION>", with `CRITERIA` as the choices. P(VIOLATED) >= 0.85 blocks.

## Shape

```python
PROPOSITION = ('At least one listed <span> <breaks the rule, concretely>: <what that looks like>. '
               '<Each exemption, by name>. In the state, that is a <span> with <field> true.')

CRITERIA = {
    'VIOLATED': 'some <span> <breaks it>',
    'SATISFIED': 'every <span> <keeps it>',
    'NOT_APPLICABLE': 'the state lists no <span>',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
```

## Rules

- **One claim.** A proposition with two independent conditions is two rules.
- **Name the state field.** MOCK went 0.51 → 0.92 when it said "every one of its assertions inspects a
  test double … In the state, that is a changed test with every_assertion_on_mock true". S-SETUP went
  0.78/0.77 → 0.93/0.94 when the state gained the fields the proposition pointed at.
- **State it positively, per site.** A1's negation-heavy "runs NO robustness check … no placebo, no …"
  scored 0.61/0.71 on its own violation; "a specification curve stands with no robustness check of a
  different kind beside it" on a per-site boolean scored 0.93/0.94.
- **Name every exemption — never leave one implicit.** The judge applies the rule's letter otherwise:
  - A-PAD: "fact rows are sanctioned evidence, never padding, however past-tense or dated their wording"
    took the accepted State Files doctrine from 0.61–0.68 to 0.21–0.31.
  - L-SUPRA: a release not published in the Federal Register (no-action letter, litigation release)
    may take supra; one that is a final or proposed rule may not.
  - E-WEFIND: the abstract, introduction and conclusion preview results and are exempt.
  - A-GATE: one advisory pass that gates nothing does not count.
  - N-NARRATION: "This slide shows X. <the substance>" is not narration — the accepted form.
- **A carve-out must not blur the clear case.** T-NARRATE's "names a visual, then states the content"
  exemption dropped its own violating twin to 0.55/0.58, because the rule's BAD example states the
  content too.
- **Use the rule's own examples.** T-TRANSITION adopted its source's GOOD examples (bare signposts
  count) rather than a paraphrase.
- **Scope words.** Say which sense counts ("significant" = statistical significance only).

## When rewording stops working

Two rounds of rewording that each fail on the same accepted case mean the question is not the
problem: the accepted work and the written rule disagree (`diagnosis.md` rows 5–7). Do not write a
third wording to make the accepted case pass — ask the user which is right, or park the rule.
