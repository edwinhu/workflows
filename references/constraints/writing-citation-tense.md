---
name: writing-citation-tense
description: Report scholarly arguments in the present tense; use the "Author (YEAR) argues that ..." form inline
applies-to: [writing-draft, writing-review, writing-revise]
---

## Rule

When citing another scholar's argument, finding, model, or claim in the body text, use the **present tense** and the inline **"Author (YEAR) argues that ..."** form.

- *"Lund (2018) argues that passive shareholders lack the economic incentives to vote substantively."* ✅
- *"Lund argued in 2017 that passive shareholders..."* ❌

The year goes in parentheses after the author's surname (no "Lund, 2018" comma form, no year folded into the verb, no "in a 2018 paper"). Longer multi-author cites follow the same pattern: *"Bebchuk, Cohen, and Hirst (2017) document..."*

Exceptions (keep past tense):
- Historical events: *"The SEC adopted Rule 14a-8 in 1942."*
- Temporally specific actions that aren't scholarly arguments: *"BlackRock launched Voting Choice in 2022."*
- Quotations from a speaker: *"As Lund put it, ..."* (historical speech-act framing).

## Rationale

Scholarly arguments persist in the text — the paper "argues" every time a reader picks it up, not only in the year of publication. Past-tense forms (*"Lund argued"*) read as if the argument has been withdrawn or is stale. Present tense is the academic default across disciplines (Chicago, MLA, APA, Bluebook-adjacent legal writing).

The parenthetical-year inline form (*"Lund (2018) argues"*) surfaces the year at the point of reference rather than burying it in a footnote — faster for the reader, tighter for the sentence. Law-review style traditionally puts the year only in the footnote; this constraint overrides that convention in favor of the inline form the user has chosen for this project.

## Examples

Wrong → Right:

| Past tense / no inline year | Present tense / inline year |
|------------------------------|------------------------------|
| *"Lund argued in 2017 that index funds should not vote."* | *"Lund (2018) argues that index funds should not vote."* |
| *"Appel, Gormley, and Keim showed in 2016 that..."* | *"Appel, Gormley, and Keim (2016) show that..."* |
| *"Bebchuk and Hirst documented this mismatch in 2017."* | *"Bebchuk, Cohen, and Hirst (2017) document this mismatch."* |
| *"In a 2019 paper, Malenko and Malenko model..."* | *"Malenko and Malenko (2019) model..."* |
| *"Fisch has argued..."* | *"Fisch (2017) argues..."* |
| *"The author acknowledged that..."* | *"The author acknowledges that..."* |

Acceptable present-tense reporting verbs: *argues, claims, contends, documents, finds, models, proposes, shows, demonstrates, notes, observes, identifies, reports, concludes, refines, acknowledges.*

## Detection Heuristic

Flag body-text sentences containing a cited author's surname followed by a past-tense reporting verb:
- `\b[A-Z]\w+(,\s+[A-Z]\w+)*\s+(argued|showed|demonstrated|claimed|found|contended|documented|noted|observed|proposed|identified|concluded|acknowledged|modeled)\b`
- Combined with any of: an inline year not in parentheses (*"in 2017,"*, *"in a 2019 paper"*); or no year at all.

Also flag inline forms that bury the year after a comma instead of in parens: *"Lund, 2018, argues"* — should be *"Lund (2018) argues."*

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "Past tense is more natural English" | Past tense is natural for events, not for persistent arguments | Present tense for arguments; past tense for events |
| "The paper came out in a specific year" | Fine — put the year in parens, keep the verb present | *"Lund (2018) argues"* |
| "Law review style puts year only in footnote" | True as a general rule, but this project has adopted inline parenthetical years | Follow the project's chosen style |
| "It's just one verb tense" | Tense shifts across a draft signal sloppy editing | Apply uniformly |
| "I'll fix it on final proofread" | "Final proofread" never comes | Fix during drafting and review |
