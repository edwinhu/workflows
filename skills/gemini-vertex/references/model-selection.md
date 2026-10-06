### Model selection: default to Flash / Flash-Lite for extraction

**For structured information extraction — schema-constrained JSON pulled out of documents — default to Flash or Flash-Lite. Reserve Pro for tasks needing genuine reasoning.** Do not reach for Pro by default just because the task feels important.

Measured on the **Gemini Developer API (not Cloud)**, 2026-08-03 on the `realpage` project (SEC IPO prospectus extraction; ~16,700 input tokens/doc, ~350-600 output; identical prompt, identical 100 documents):

| model | finds the target provision | quote-verification | judge | cost/doc | 1,926-doc run |
|---|---|---|---|---|---|
| `gemini-3.1-pro-preview` | 47% | 97.9% | 1.00 | $0.0187 | ~$36 |
| `gemini-3.6-flash` | 62% | 95.2% | 0.85 | $0.0151 | ~$29 |
| `gemini-3.5-flash` | 70% | 94.3% | 1.00 | $0.0149 | ~$29 |

**Pro was the most conservative extractor, not the best one.** It found the target provision in 47% of documents where Flash found 62-70% of the *same* documents. On an extraction task Pro's extra reasoning showed up as under-extraction — the failure mode that silently biases a research dataset. Scored against **held-out human hand-coding** (20 rows the research team coded before the pipeline existed, never having seen a machine output), **all four models were identical** — 85.0% exact agreement, 90% recall on real entitlements, 80% exact on those — and they failed on the *same three rows*. So Pro's extra reasoning bought nothing measurable, while its conservatism cost 15-23 points of detection.

Two honest caveats. The human sample was small (20 rows, 11 companies), and identical failures on identical rows says the *residual* errors were structural — a provision filed in an exhibit rather than the prospectus, a right held through a GP entity — not model quality. And the detection gap itself stayed **unresolved**: on the documents where models disagreed there was no ground truth, so which model is right on that 23-point spread was still open. Do not read this table as "Flash is more accurate"; read it as "Pro was not measurably better, and was measurably quieter."

**Cost savings from Pro → Flash are smaller than people expect when the task is input-dominated.** Here it was only ~20%, because Flash input is $0.75/1M against Pro's $1.00, while output — where Flash is much cheaper — was a rounding error at ~350 tokens. **In this measured lineup, Flash-Lite was the only tier that cut input price materially** ($0.15/1M, ~85% saving). Work out whether the job is input- or output-dominated *before* assuming a Flash switch saves real money: compute `mean_input_tokens * input_price` vs `mean_output_tokens * output_price` from a Stage 2 sample (see `references/scale-up-testing.md`).

(measured 2026-08-03; model IDs as of then)
