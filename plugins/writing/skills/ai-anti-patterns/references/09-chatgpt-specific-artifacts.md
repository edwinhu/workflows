# ChatGPT-Specific Artifacts

## turn0search0

ChatGPT may include `citeturn0search0` (surrounded by Unicode points in the [Private Use Area](https://en.wikipedia.org/wiki/Private_Use_Area "Private Use Area")) at the ends of sentences, with the number after "search" increasing as the text progresses. These are places where the chatbot links to an external site, but a human pasting the conversation into Wikipedia has that link converted into placeholder code. This was first observed in February 2025.

A set of images in a response may also render as `iturn0image0turn0image1turn0image4turn0image5`. Rarely, other markup of a similar style, such as `citeturn0news0` ([example](https://en.wikipedia.org/wiki/Special:PermanentLink/1276934509 "Special:PermanentLink/1276934509")), `citeturn1file0` ([example](https://en.wikipedia.org/wiki/Special:PermanentLink/1286349902 "Special:PermanentLink/1286349902")), or `cite*generated-reference-identifier*` ([example](https://en.wikipedia.org/wiki/Special:PermanentLink/1276907078 "Special:PermanentLink/1276907078")), may appear.

**Examples**

> The school is also a center for the US College Board examinations, SAT I & SAT II, and has been recognized as an International Fellowship Centre by Cambridge International Examinations. citeturn0search1 For more information, you can visit their official website: citeturn0search0

— From [this revision](https://en.wikipedia.org/w/index.php?title=&diff=1274664396&oldid=) to [List of English-medium schools in Bangladesh](https://en.wikipedia.org/wiki/List_of_English-medium_schools_in_Bangladesh "List of English-medium schools in Bangladesh")

- [turn0search0 OR turn0search1 OR turn0search2 OR turn0search3 OR turn0search4 OR turn0search5 OR turn0search6 OR turn0search7](https://en.wikipedia.org/w/index.php?title=Special:Search&search=turn0search0+OR+turn0search1+OR+turn0search2+OR+turn0search3+OR+turn0search4+OR+turn0search5+OR+turn0search6+OR+turn0search7&ns0=1&fulltext=Search)
- [turn0image0 OR turn0image1 OR turn0image2 OR turn0image3 OR turn0image4 OR turn0image5 OR turn0image6 OR turn0image7](https://en.wikipedia.org/w/index.php?title=Special:Search&search=turn0image0+OR+turn0image1+OR+turn0image2+OR+turn0image3+OR+turn0image4+OR+turn0image5+OR+turn0image6+OR+turn0image7&ns0=1&fulltext=Search)

## contentReference and oaicite

Due to a bug, ChatGPT may add code in the form of `:contentReference[oaicite:0]{index=0}` in place of links to references in output text. Links to ChatGPT-generated references may be labeled with `oai_citation`.

**Examples**

> :contentReference\[oaicite:16\]{index=16}
>
> 1\. \*\*Ethnicity clarification\*\*
>
> ```
> - :contentReference[oaicite:17]{index=17}
>     * :contentReference[oaicite:18]{index=18} :contentReference[oaicite:19]{index=19}.
>     * Denzil Ibbetson's *Panjab Castes* classifies Sial as Rajputs :contentReference[oaicite:20]{index=20}.
>     * Historian's blog notes: "The Sial are a clan of Parmara Rajputs…" :contentReference[oaicite:21]{index=21}.
> ```
>
> 2.:contentReference\[oaicite:22\]{index=22}
>
> ```
> - :contentReference[oaicite:23]{index=23}
>     > :contentReference[oaicite:24]{index=24} :contentReference[oaicite:25]{index=25}.
> ```

— From [this revision](https://en.wikipedia.org/w/index.php?title=&diff=1294765751&oldid=) to [Talk:Sial (tribe)](https://en.wikipedia.org/wiki/Talk:Sial_\(tribe\) "Talk:Sial (tribe)").

> \#### 📌 Key facts needing addition or correction:
>
> 1\. \*\*Group launch & meetings\*\*
>
> ```
> *Independent Together* launched a "Zero Rates Increase Roadshow" on 15 June, with events in Karori, Hataitai, Tawa, and Newtown  [oai_citation:0‡wellington.scoop.co.nz](https://wellington.scoop.co.nz/?p=171473&utm_source=chatgpt.com).
> ```
>
> 2\. \*\*Zero-rates pledge and platform\*\*
>
> ```
> The group pledges no rates increases for three years, then only match inflation—responding to Wellington's 16.9% hike for 2024/25  [oai_citation:1‡en.wikipedia.org](https://en.wikipedia.org/wiki/Independent_Together?utm_source=chatgpt.com).
> ```

— From [this revision](https://en.wikipedia.org/w/index.php?title=&diff=1296028135&oldid=) to [Talk:Independent Together](https://en.wikipedia.org/wiki/Talk:Independent_Together "Talk:Independent Together")

- ["contentReference" OR "oaicite" OR "oai\_citation"](https://en.wikipedia.org/w/index.php?search=%22contentReference%22+OR+%22oaicite%22+OR+%22oai_citation%22&title=Special%3ASearch)

## Attribution JSON

ChatGPT may add [JSON](https://en.wikipedia.org/wiki/JSON "JSON") -formatted code at the end of sentences in the form of `({"attribution":{"attributableIndex":"X-Y"}})`, with X and Y being increasing numeric indices.

**Examples**

> ^\[Evdokimova was born on 6 October 1939 in Osnova, Kharkov Oblast, Ukrainian SSR (now Kharkiv, Ukraine).\]({"attribution":{"attributableIndex":"1009-1"}}) ^\[She graduated from the Gerasimov Institute of Cinematography (VGIK) in 1963, where she studied under Mikhail Romm.\]({"attribution":{"attributableIndex":"1009-2"}}) \[oai\_citation:0‡IMDb\]([https://www.imdb.com/name/nm0947835/?utm\_source=chatgpt.com](https://www.imdb.com/name/nm0947835/?utm_source=chatgpt.com)) \[oai\_citation:1‡maly.ru\]([https://www.maly.ru/en/people/EvdokimovaA?utm\_source=chatgpt.com](https://www.maly.ru/en/people/EvdokimovaA?utm_source=chatgpt.com))

— From [Draft:Aleftina Evdokimova](https://en.wikipedia.org/wiki/User:Sohom_Datta/attributeIndex "User:Sohom Datta/attributeIndex")

> Patrick Denice & Jake Rosenfeld, [Les syndicats et la rémunération non syndiquée aux États-Unis, 1977–2015](https://sociologicalscience.com/articles-v5-23-541/), ''Sociological Science'' (2018).\]({"attribution":{"attributableIndex":"3795-0"}})

— From [this diff](https://fr.wikipedia.org/wiki/Special:Diff/225259294 "fr:Special:Diff/225259294") to [fr:Syndicalisme aux États-Unis](https://fr.wikipedia.org/wiki/Syndicalisme_aux_%C3%89tats-Unis "fr:Syndicalisme aux États-Unis")
