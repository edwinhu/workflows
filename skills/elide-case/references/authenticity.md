# Authenticity — the two Iron Laws

These two laws govern every excerpt this skill produces. Neither bends for speed, for a
tight page target, or for a passage that "obviously" says what you remember it saying.

## Iron Law 1 — The Iron Law of Authentic Text

**Every word of the excerpt is authentic reporter text, retrieved this run and saved under
`docs/`. Never drafted from memory, from a Teacher's Manual summary, or from a casebook
note. This is not negotiable.**

The excerpt is cut from the `.txt` retrieved THIS RUN and saved in `docs/` — never from
another copy of the opinion, a reporter PDF opened alongside, or a previous excerpt.

### Why the law is written this way

A plausible-sounding paraphrase handed to students as a quoted opinion is fabricated
authority in a course reader. Students cite it, quote it on an exam, and carry it into
practice. Producing the excerpt faster by writing what the case "says" is the opposite of
helpful — it puts the instructor's name on words no court wrote.

The drive to violate this law is always the same drive: the retrieval is slow, or 404s, or
the corpus does not have the cite, and the opinion's holding is sitting right there in the
Teacher's Manual in clean prose. That moment is the law's entire reason for existing. A
citation lookup that fails means *take the other retrieval route*, never *write it from
what you know*. See `retrieval.md`.

### What a match does and does not prove — and it depends on the source

`check-quotes.py` matching a sentence proves fidelity to the **file**. Whether that is also
fidelity to the reporter is a question about where the file came from.

- **Publisher-keyed source (`.westlaw.docx`, retrieved through `workflows:westlaw`).** The
  characters are the publisher's own, so a match is fidelity to the reporter text. No
  page-image comparison is required. The docx is projected to text in memory, italic runs
  preserved; nothing writes that projection to disk.
- **OCR source (CourtListener opinions corpus, Caselaw Access Project).** A match proves only
  fidelity to the file: an OCR-damaged `.txt` matches its own damage perfectly. The Life
  Partners corpus `.txt` contains `quite the opposite is 'rue`, `Entrepreneurial Junctions`
  (for *Functions*) and `and .the question`, and 02-addendum carried all three into print
  because they were grepped against and matched. **Any passage you retain from an OCR source
  must also be eyeballed against the page image.** See `retrieval.md`.

## Iron Law 2 — The Iron Law of Compile-Before-Table

**The summary table is written AFTER the compile, from `check-addendum.py`'s computed
output. Never before, never from an estimate.**

Page numbers do not exist until Typst lays the document out. A table written first is a
guess, and a guess that reads as fact is what sends a student to page 13 for a reading that
starts on page 15.

### The drive-framing

The pull here is that the table is the easy part and you can *see* roughly where each
reading falls. Writing it early feels like getting ahead. It is not: it converts a layout
fact into a prediction, and then the compile either confirms the prediction or the
temptation becomes to nudge the table. **Never hand-edit a table range so the checker
passes.** The checker is reporting the truth about the PDF; the source is what is wrong.

## Fidelity beyond verbatim matching

Verbatim matching cannot see misrepresentation. An excerpt can be word-perfect and still
lie about the opinion:

- A passage the court **quotes from another case** presented as the court's own reasoning.
  02-addendum did exactly this: a *Life Partners* block quote rendered as running text
  inside the *Mutual Benefits* excerpt, where the Eleventh Circuit quotes it in order to
  **reject** it.
- A holding stated without the qualifier or limiting clause that confines it.
- An omitted alternative holding that changes what the case stands for.
- A dissent's language read as the majority's.
- **The court's typography dropped or invented.** A case name the reporter sets in italics,
  reproduced in roman, is a misquotation that word-for-word matching cannot see: `norm()` folds
  emphasis away on both sides, so a verbatim PASS says nothing about it. The excerpt inherits the
  source's italics. On a `.txt` source there are none to inherit, which the gate says out loud.

None of these is catchable by a grep. They are what the advisory **fidelity** lens looks
for, and what a human reading the compiled PDF is there to catch.
