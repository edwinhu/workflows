---
name: ds-native-document-input
description: Send documents to a multimodal model in their native format — never pre-extract text
applies-to: [ds]
---

# E6 — Native document input: never pre-extract text for a multimodal model

**Rule.** When a document (PDF, image, scan) is going to a multimodal model, send the **document**.
Do not run `pdftotext`, `pypdf`, `pdfminer`, `fitz`/PyMuPDF, `docling`, OCR or any other extractor
first and send the resulting string. Extraction is for *deterministic local work* — verifying a
quote, grepping for a pattern, counting pages. It is never the model's input path.

## Why — it is more expensive AND less accurate, both measured

**Cost.** A PDF page bills at a flat **258 tokens** regardless of density, and native text inside the
PDF is extracted by the provider **without being charged** (Gemini document-processing docs, verified
2026-08-17; 1,000 pages / 50 MB per document). Extracted text bills per character. On the realpage
ADV corpus a ~97,000-character brochure is ~24,000 text tokens against roughly 10,000 as a ~40-page
PDF. The gap widens with document size, because a long document must then be **chunked** — and
chunking bills the overlap twice and re-sends the prompt once per window. One brochure in that corpus
cost **157,041 input tokens across 5 chunks**; the same document is a single request as a PDF.

**Accuracy.** Text extraction is where the artifacts come from. Page numbers and running headers land
mid-sentence once newlines collapse, and hyphens die at line breaks — on a 100-quote hand-checked
sample, 46 quotes failed a verbatim gate for an interposed page number alone, and every one of the
100 was really in the document. A model reading the PDF never sees those defects, because they are
produced by the extractor and not by the page.

## The check

Decidable, and it belongs in the pipeline rather than in a reviewer's judgement:

1. **Grep the model call path.** No extractor output may reach a request builder. A `read_text()`,
   `pdftotext`, `extract_text()` or `page.get_text()` whose value flows into `contents`, `parts`,
   `inline_data` or a JSONL request line is a violation.
2. **Assert at the boundary.** The request builder takes the document, not a string: parts carry
   `inline_data`/`file_data` with `mime_type: application/pdf` (or the image type). Make the wrong
   shape unrepresentable — a builder that accepts `str` document content is the defect.
3. **State the token basis.** Any cost estimate says whether it is pages × 258 or characters ÷ 4.
   An estimate that cannot say which is not an estimate.

## The one legitimate exception, and its condition

Extraction is still the right tool for **deterministic verification** — an anti-fabrication gate that
checks a model's quote against the source has to compare against *something*. The rule is about the
model's input path, not about ever running an extractor.

**Extract at query time, do not store a parallel text corpus.** `rga` searches PDFs directly
(`rga -c "<phrase>" file.pdf`), so a quote can be confirmed against the PDF that was actually sent,
with no `.txt` sitting beside it. A stored text corpus is a second representation of one document
that can drift from it, and keeping the two in sync is work that buys nothing the query-time path
does not already give.

Two things that path does NOT buy, and a gate written as if it did will fail on real documents:

- **`rga` is the same extractor.** Its poppler adapter runs `pdftotext - -` (verified
  `rga --rga-list-adapters`), so every artifact above — page numbers landing mid-sentence, hyphens
  lost at line breaks — appears in its output exactly as it would in a stored `.txt`.
- **`rga` adds one of its own.** Its `postprocpagebreaks` adapter prefixes every output line with
  `Page N:`.

So the comparison side still has to fold those artifacts away — strip page furniture before
collapsing newlines, tolerate hyphenation lost at a line break, ignore the `Page N:` prefix — and it
must never be "fixed" by degrading the model's input to match whatever the extractor produced.

If a document genuinely cannot be sent natively — it exceeds the page or size ceiling, or the
provider has no document modality — say so with the number that proves it, and split the document
rather than flattening it to text.
