# Markup Issues

## Use of Markdown

```
## Formatting Guidelines

- All output uses GitHub-flavored Markdown.
- Use a single main title (\`#\`) and clear primary subheadings (\`##\`).
- Keep paragraphs short (3–5 sentences, ≤150 words).
- Break large topics into labeled subsections.
- Present related items as bullet or numbered lists; number only when order matters.
- Always leave a blank line before and after each paragraph.
- Avoid bold or italic styling in body text unless explicitly requested.
- Use horizontal dividers (\`---\`) between major sections.
- Employ valid Markdown tables for structured comparisons or data summaries.
- Refrain from complex Unicode symbols; stick to simple characters.
- Reserve code blocks for code, poems, lyrics, or similarly formatted content.
- For mathematical expressions, use LaTeX outside of code blocks.
```

As the above suggests, Markdown's syntax is completely different from wikitext's: Markdown uses asterisks (\*) or underscores (\_) instead of single-quotes (') for bold and italic formatting, hash symbols (#) instead of equals signs (=) for section headings, parentheses (()) instead of square brackets (\[\]) around URLs, and three symbols (---, \*\*\*, or \_\_\_) instead of four hyphens (----) for thematic breaks.

Even when they are told to do so explicitly, chatbots generally struggle to generate text using syntactically correct wikitext, as their training data lead to a drastically greater affinity for and fluency in Markdown. When told to "generate an article", a chatbot will typically default to using Markdown for the generated output, which is preserved in clipboard text by the copy functions on some chatbot platforms. If instructed to generate content for Wikipedia, the chatbot might "realize" the need to generate Wikipedia-compatible code, and might include a message like Would you like me to... turn this into actual Wikipedia markup format (\`wikitext\`)?[^3] in its output. If the chatbot is told to proceed, the resulting syntax will often be rudimentary, syntactically incorrect, or both. The chatbot might put its attempted-wikitext content in a Markdown-style [fenced code block](https://www.markdownguide.org/extended-syntax/#fenced-code-blocks) (its syntax for [WP:PRE](https://en.wikipedia.org/wiki/Wikipedia:PRE "Wikipedia:PRE")) surrounded by Markdown-based syntax and content, which may also be preserved by platform-specific copy-to-clipboard functions, leading to a telling footprint of both markup languages' syntax. This might include the appearance of three backticks in the text, such as: ` ```wikitext `.[^4]

The presence of faulty wikitext syntax mixed with Markdown syntax is a strong indicator that content is LLM-generated, especially if in the form of a fenced Markdown code block. However, Markdown *alone* is not such a strong indicator. Software developers, researchers, technical writers, and experienced internet users frequently use Markdown in tools like [Obsidian](https://en.wikipedia.org/wiki/Obsidian_\(software\) "Obsidian (software)") and [GitHub](https://en.wikipedia.org/wiki/GitHub_Flavored_Markdown "GitHub Flavored Markdown"), and on platforms like [Reddit](https://support.reddithelp.com/hc/en-us/articles/360043033952-Formatting-Guide), [Discord](https://support.discord.com/hc/en-us/articles/210298617-Markdown-Text-101-Chat-Formatting-Bold-Italic-Underline), and [Slack](https://slack.com/help/articles/202288908-Format-your-messages). Some writing tools and apps, such as [iOS Notes](https://en.wikipedia.org/wiki/IOS_Notes "IOS Notes"), [Google Docs](https://en.wikipedia.org/wiki/Google_Docs "Google Docs"), and [Windows Notepad](https://en.wikipedia.org/wiki/Windows_Notepad "Windows Notepad"), support Markdown editing or exporting. The increasing ubiquity of Markdown may also lead new editors to expect or assume Wikipedia to support Markdown by default.

**Examples**

> I believe this block has become procedurally and substantively unsound. Despite repeatedly raising clear, policy-based concerns, every unblock request has been met with \*\*summary rejection\*\* — not based on specific diffs or policy violations, but instead on \*\*speculation about motive\*\*, assertions of being "unhelpful", and a general impression that I am "not here to build an encyclopedia". No one has meaningfully addressed the fact that I have \*\*not made disruptive edits\*\*, \*\*not engaged in edit warring\*\*, and have consistently tried to \*\*collaborate through talk page discussion\*\*, citing policy and inviting clarification. Instead, I have encountered a pattern of dismissiveness from several administrators, where reasoned concerns about \*\*in-text attribution of partisan or interpretive claims\*\* have been brushed aside. Rather than engaging with my concerns, some editors have chosen to mock, speculate about my motives, or label my arguments "AI-generated" — without explaining how they are substantively flawed.

— From [this revision](https://en.wikipedia.org/w/index.php?title=&diff=1284964006&oldid=) to a user talk page

> \- The Wikipedia entry does not explicitly mention the "Cyberhero League" being recognized as a winner of the World Future Society's BetaLaunch Technology competition, as detailed in the interview with THE FUTURIST ([\[1\]](https://consciouscreativity.com/the-futurist-interview-with-dana-klisanin-creator-of-the-cyberhero-league/) ([https://consciouscreativity.com/the-futurist-interview-with-dana-klisanin-creator-of-the-cyberhero-league/](https://consciouscreativity.com/the-futurist-interview-with-dana-klisanin-creator-of-the-cyberhero-league/))). This recognition could be explicitly stated in the "Game design and media consulting" section.

— From [this revision](https://en.wikipedia.org/w/index.php?title=&diff=1290202502&oldid=) to [Talk:Dana Klisanin](https://en.wikipedia.org/wiki/Talk:Dana_Klisanin "Talk:Dana Klisanin")

Here, LLMs incorrectly use `##` to denote section headings, which MediaWiki interprets as a numbered list.

> 1. 1. Geography
>
> Villers-Chief is situated in the [Jura Mountains](https://en.wikipedia.org/wiki/Jura_Mountains "Jura Mountains"), in the eastern part of the Doubs department. \[...\]
>
> 1. 1. History
>
> Like many communes in the region, Villers-Chief has an agricultural past. \[...\]
>
> 1. 1. Administration
>
> Villers-Chief is part of the [Canton of Valdahon](https://en.wikipedia.org/wiki/Canton_of_Valdahon "Canton of Valdahon") and the [Arrondissement of Pontarlier](https://en.wikipedia.org/wiki/Arrondissement_of_Pontarlier "Arrondissement of Pontarlier"). \[...\]
>
> 1. 1. Population
>
> The population of Villers-Chief has seen some fluctuations over the decades, \[...\]

— From [this revision](https://en.wikipedia.org/wiki/Special:Diff/1294887075 "Special:Diff/1294887075") to [Villers-Chief](https://en.wikipedia.org/wiki/Villers-Chief "Villers-Chief")

## Broken wikitext

As explained above, AI-chatbots are not proficient in wikitext and Wikipedia templates, leading to faulty syntax. A noteworthy instance is garbled code related to [Template:AfC submission](https://en.wikipedia.org/wiki/Template:AfC_submission "Template:AfC submission"), as new editors might ask a chatbot how to submit their [Articles for Creation](https://en.wikipedia.org/wiki/Wikipedia:Articles_for_Creation "Wikipedia:Articles for Creation") draft; see [this discussion among AfC reviewers](https://en.wikipedia.org/wiki/Special:PermanentLink/1299830745#Messed_up_templates "Special:PermanentLink/1299830745").

**Examples**

Note the badly malformed category link:

> ```
> [[Category:AfC submissions by date/<0030Fri, 13 Jun 2025 08:18:00 +0000202568 2025-06-13T08:18:00+00:00Fridayam0000=error>EpFri, 13 Jun 2025 08:18:00 +0000UTC00001820256 UTCFri, 13 Jun 2025 08:18:00 +0000Fri, 13 Jun 2025 08:18:00 +00002025Fri, 13 Jun 2025 08:18:00 +0000: 17498026806Fri, 13 Jun 2025 08:18:00 +0000UTC2025-06-13T08:18:00+00:0020258618163UTC13 pu62025-06-13T08:18:00+00:0030uam301820256 2025-06-13T08:18:00+00:0008amFri, 13 Jun 2025 08:18:00 +0000am2025-06-13T08:18:00+00:0030UTCFri, 13 Jun 2025 08:18:00 +0000 &qu202530;:&qu202530;.</0030Fri, 13 Jun 2025 08:18:00 +0000202568>June 2025|sandbox]]
> ```

— From [this revision](https://en.wikipedia.org/wiki/Special:PermanentLink/1295363321 "Special:PermanentLink/1295363321") to [User:Dr. Omokhudu Idogho/sandbox](https://en.wikipedia.org/wiki/User:Dr._Omokhudu_Idogho/sandbox "User:Dr. Omokhudu Idogho/sandbox")

[^3]: [Example](https://en.wikipedia.org/wiki/Special:PermanentLink/1300700102 "Special:PermanentLink/1300700102") (deleted, administrators only)

[^4]: [Example](https://en.wikipedia.org/wiki/Special:PermanentLink/1297827841 "Special:PermanentLink/1297827841") of ` ```wikitext ` on a draft.
