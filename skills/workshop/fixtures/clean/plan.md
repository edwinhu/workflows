# Fixture plan: a clean workshop run

The minimal approved plan satisfying `references/slide-spec-grammar.md`. Tests copy this tree and
break exactly one clause at a time.

## Presentation Intent

Show the ownership-payout result to a fixture audience.

## Audience, Venue, Duration, and Proportions

Fixture audience, fixture venue, three slides, one per section beat.

## Source Paper

| Field | Value |
|---|---|
| path | paper.md |
| title | Blockholders and Payout Policy |

## Source Inventory

| ID | Kind | Source |
|---|---|---|
| F2 | figure | Figure 2, the event study |
| R1 | result | The four-point payout coefficient |
| T3 | table | Table 3, the panel coverage |
| A4 | argument | The paper's identification claim |
| F10 | figure | Figure 10, the placebo window |

## Slide Spec

| Slide | Section | Takeaway | Bullets | Inventory | Visual | Notes |
|---|---|---|---|---|---|---|
| Concentrated ownership predicts higher payout. | Motivation | Ownership tracks payout | Two trend bullets | R1, A4 | none | Open on the puzzle |
| The panel spans 1994 through 2019. | Data | Coverage is annual | Coverage and edges | T3, A4 | none | Explain the edges |
| Blockholders raise dividends by four points. | Result | The estimate is stable | Estimate and event study | R1, F2 | none | Give the estimate once |

## Outputs and Verification

| Artifact | Path |
|---|---|
| deck | presentation/slides.typ |
| notes | presentation/notes.typ |
| deck-pdf | presentation/slides.pdf |
| notes-pdf | presentation/notes.pdf |

## Review Surfaces

The rendered deck and the rendered notes.
