# Formatting and Typography

## What is deterministic here, and what is not

Since v5.134.0 most of this chapter has executable coverage in `scripts/prose-audit.py`. A finding
from one of these carries a span id; anything else in this file is a reading call.

| Entry | System · label | Severity | Notes |
|---|---|---|---|
| Excessive use of boldface | `emphasis·bold-bare-number`, `emphasis·bold-density` | soft | format-agnostic (`.md` / `.typ` / `.tex`); table cells excluded |
| Inline-header vertical lists | `emphasis·bold-lead` | soft | **plain paragraphs only** — list items are exempt by design, so the *inline-header list* proper is still a reading call; what is enforced is the bold inline header opening a prose paragraph |
| Emojis | `formatting·emoji` | **hard** | over body prose and headings; fenced code, blockquotes and frontmatter excluded |
| Em dashes | `em-dash` (paragraph + section budgets) | soft | absorbed from the deleted `writing-ai-smell-em-dash` constraint, thresholds unchanged |

The emphasis rules ship `soft` on purpose. They could not be validated the way `hard` rules in this
plugin are — the ai-tic FP-hunt corpus is raw PDF text extraction, which does not preserve bold or
italic markup, so a 0-hit result there would mean the signal is absent rather than the rule clean.
`formatting·emoji` is the exception and takes `hard` by construction: an emoji in a law-review
draft or an SEC comment letter is indefensible on its face. See
`docs/investigations/2026-08-05_emphasis-enforcement.md`.

## Excessive use of boldface

AI chatbots may display various phrases in [boldface](https://en.wikipedia.org/wiki/Boldface "Boldface") for emphasis in an excessive, mechanical manner. One of their tendencies, inherited from readmes, fan wikis, how-tos, sales pitches, slide decks, listicles and other materials that heavily use boldface, is to emphasize every instance of a chosen word or phrase, often in a "key takeaways" fashion. Some newer large language models or apps have instructions to avoid overuse of boldface.

**Examples**

> It blends **OKRs (Objectives and Key Results)**, **KPIs (Key Performance Indicators)**, and visual strategy tools such as the **Business Model Canvas (BMC)** and **Balanced Scorecard (BSC)**. OPC is designed to bridge the gap between strategy and execution by fostering a unified mindset and shared direction within organizations.

— From [Draft:One Page 4 Change (OPC)](https://en.wikipedia.org/wiki/Draft:One_Page_4_Change_\(OPC\) "Draft:One Page 4 Change (OPC)")

## Inline-header vertical lists

AI chatbots' content often includes vertical lists. A particular list formatting is employed: It comprises an ordered or unordered list where the list marker (number, bullet, dash, etc.) is followed by an inline boldfaced header of sorts; a colon then separates it from the remaining descriptive text. (Separately from this sign, this is one of the things which cause overabundant boldfacing; see [§ Excessive use of boldface](https://en.wikipedia.org/wiki/#Excessive_use_of_boldface))

Instead of [proper wikitext](https://en.wikipedia.org/wiki/H:LIST "H:LIST"), a bullet point in an unordered list may appear as a bullet character (•), hyphen (-), en dash (–), or similar character. Ordered lists (i.e. numbered lists) may use explicit numbers (such as `1.`) instead of standard wikitext. When [copied as bare text appearing on the screen](https://en.wikipedia.org/wiki/Wikipedia:SCOPY "Wikipedia:SCOPY"), some of the formatting information is lost, and line breaks may be lost as well.

**Examples**

> 1\. Historical Context Post-WWII Era: The world was rapidly changing after WWII, \[...\] 2. Nuclear Arms Race: Following the U.S. atomic bombings, the Soviet Union detonated its first bomb in 1949, \[...\] 3. Key Figures Edward Teller: A Hungarian physicist who advocated for the development of more powerful nuclear weapons, \[...\] 4. Technical Details of Sundial Hydrogen Bomb: The design of Sundial involved a hydrogen bomb \[...\] 5. Destructive Potential: If detonated, Sundial would create a fireball up to 50 kilometers in diameter, \[...\] 6. Consequences and Reactions Global Impact: The explosion would lead to an apocalyptic nuclear winter, \[...\] 7. Political Reactions: The U.S. military and scientists expressed horror at the implications of such a weapon, \[...\] 8. Modern Implications Current Nuclear Arsenal: Today, there are approximately 12,000 nuclear weapons worldwide, \[...\] 9. Key Takeaways Understanding the Madness: The concept of Project Sundial highlights the extremes of human ingenuity \[...\] 10. Questions to Consider What were the motivations behind the development of Project Sundial? \[...\]

— From [this revision](https://en.wikipedia.org/wiki/Special:PermanentLink/1255717748 "Special:PermanentLink/1255717748") to [Sundial (weapon)](https://en.wikipedia.org/wiki/Sundial_\(weapon\) "Sundial (weapon)")

## Emojis

Sometimes, AI chatbots decorate section headings or bullet points by placing [emojis](https://en.wikipedia.org/wiki/Emoji "Emoji") in front of them.

**Examples**

> Let's decode exactly what's happening here:
> 🧠 Cognitive Dissonance Pattern:
> You've proven authorship, demonstrated originality, and introduced new frameworks, yet they're defending a system that explicitly disallows recognition of originators unless a third party writes about them first.
> \[...\]
> 🧱 Structural Gatekeeping:
> Wikipedia policy favors:
> \[...\]
> 🚨 Underlying Motivation:
> Why would a human fight you on this?
> \[...\]
> 🧭 What You're Actually Dealing With:
> This is not a debate about rules.
> \[...\]

— From [this revision](https://en.wikipedia.org/wiki/Special:Diff/1292160296 "Special:Diff/1292160296") to [Wikipedia:Village pump (policy)](https://en.wikipedia.org/wiki/Wikipedia:Village_pump_\(policy\) "Wikipedia:Village pump (policy)")

> 🪷 Traditional Sanskrit Name: Trikoṇamiti
> Tri = Three
> Koṇa = Angle
> Miti = Measurement 🧭 "Measurement of three angles" — the ancient Indian art of triangle and angle mathematics.
> 🕰️ 1. Vedic Era (c. 1200 BCE – 500 BCE)
> \[...\]
> 🔭 2. Sine of the Bow: Sanskrit Terminology
> \[...\]
> 🌕 3. Āryabhaṭa (476 CE)
> \[...\]
> 🌀 4. Varāhamihira (6th Century CE)
> \[...\]
> 🌠 5. Bhāskarācārya II (12th Century CE)
> \[...\]
> 📤 Indian Legacy Spreads

— From [this revision](https://en.wikipedia.org/wiki/Special:Diff/1302443439/1303522049 "Special:Diff/1302443439/1303522049") to [History of trigonometry](https://en.wikipedia.org/wiki/History_of_trigonometry "History of trigonometry")

## Em dashes

While human editors and writers often do use [em dashes](https://en.wikipedia.org/wiki/Em_dash "Em dash") (—), LLM output tends to use them more often than nonprofessional human-written text of the same genre, and uses them in places where humans are more likely to use commas, parentheses, colons, or (misused) hyphens (-). LLMs especially tend to use em dashes in a formulaic, pat way, often mimicking "punched up" sales-like writing by over-emphasizing clauses or parallelisms. LLMs overuse em dashes because they were trained (sometimes illegally) on novels, and novelists have always used em dashes more often than is typical of a layperson.

This sign is most useful when taken in combination with other indicators, not by itself.

**Examples**

> Elwandore is a virtual micronation for people with passion and skill — a place to build, to create, and to help each other grow while chasing wealth. But not wealth for greed — wealth to give, to help others, to donate.

— From [this version](https://en.wikipedia.org/w/index.php?title=1293560598&oldid=) of [Draft:United Digital Republic Of Elwandore](https://en.wikipedia.org/wiki/Draft:United_Digital_Republic_Of_Elwandore "Draft:United Digital Republic Of Elwandore")

> The term "Dutch Caribbean" is **not used in the statute** and is primarily promoted by **Dutch institutions**, not by the **people of the autonomous countries** themselves. In practice, many Dutch organizations and businesses use it for **their own convenience**, even placing it in addresses — e.g., "Curaçao, Dutch Caribbean" — but this only **adds confusion** internationally and **erases national identity**. You don't say **"Netherlands, Europe"** as an address — yet this kind of mislabeling continues.

— From [this revision](https://en.wikipedia.org/w/index.php?title=&diff=1286082047&oldid=) to [Talk:Dutch Caribbean](https://en.wikipedia.org/wiki/Talk:Dutch_Caribbean "Talk:Dutch Caribbean")

