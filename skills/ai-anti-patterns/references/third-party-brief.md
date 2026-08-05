# Third-party brief — AI writing tells that no regex can express

*Handed to a non-Claude reviewer as DATA by `beat-third-party`. It is resolved from the bare skill
name `ai-anti-patterns`; a reviewer reading this is not expected to open anything else.*

This file exists because the rest of this skill is written to drive a tool loop inside one harness —
scripts to run, tables to lint with — and none of that is usable by a foreign reviewer. What follows
is only the judgement half: findings from The Economist's 2026 corpus study (55,940 sentences of AI
rewrites across 14 model variants, measured against news, fiction, and their own prose). These are
**dated judgements, not rules**, and a deterministic scorer has already run over the document you are
reading — its output is in the span list, so do not re-derive it.

- **A word-level AI tic has a HALF-LIFE.** Models drop the tells people mock: "delve", "rich
  tapestry" and "leveraging" have all decayed since 2024. Weight CONSTRUCTION-level tics (the
  reasoning-chain leak, the chatbot opener, "not X but Y") above vocabulary tics — a construction
  comes from how the model plans a sentence, not from a token preference.

- **EM-DASHES SPLIT BY MODEL; they did not die.** Only Claude now uses more of them than human
  writers, and ChatGPT uses markedly fewer than anyone. Do NOT read a low em-dash count as human, and
  do not report em-dash density on its own. (This is also the single reason a second model is worth
  paying for here: the author's own reviewers are Claude, so this is the one tell they read as
  ordinary prose.)

- **THE REGISTER YOU ARE READING DECIDES, not a news-and-fiction baseline.** The study names
  "significant", "increasingly" and "consequences" as AI-overused. In scholarly law and finance prose
  "significant" runs >80 per million and is unremarkable.

- **"not only … but also" and "not X but Y" are LLM favourites AND legitimate distinction-drawing
  moves** in legal prose. Only the redundant-restatement form is a tell — "not partially, not
  ambiguously, but definitively": three negations for one idea.

- **What the study did find, and what is worth looking for:** bland, pretentious prose lavished with
  Latinate words; long words crowding out Saxon ones; almost no semicolons; hardly any parentheses;
  long sentences with no short punchy ones between them; nominalisations ("expansion" for "expand");
  and triads whose three members restate one idea.

**The trajectory, which is why none of this is permanent.** The study's own chart shows AI prose
converging on human prose with every model release, because models are trained on human writing and
tuned on human feedback — picking up what people find impressive and dropping what they do not. Date
every rule; re-measure rather than inherit.

Full study notes, if you have file access and a finding turns on the detail:
`skills/ai-anti-patterns/references/12-economist-2026-corpus-study.md`.
