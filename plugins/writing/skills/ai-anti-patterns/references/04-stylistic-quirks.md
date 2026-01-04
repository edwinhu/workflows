# Stylistic Quirks

## Elegant variation

Generative AI has a repetition-penalty code, meant to discourage it from reusing words too often.[^8] For instance, the output might give a main character's name and then repeatedly use a different synonym or related term (e.g., protagonist, key player, eponymous character) when mentioning it again.

Note: If a user adds multiple pieces of AI-generated content in separate edits, this tell may not apply, as each piece of text may have been generated in isolation.

**Examples**

> Vierny, after a visit in Moscow in the early 1970's, committed to supporting artists resisting ==the constraints of socialist realism== and discovered Yankilevskly, among others such as Ilya Kabakov and Erik Bulatov. In ==the challenging climate of Soviet artistic constraints==, Yankilevsky, alongside other ==non-conformist artists==, faced obstacles in expressing ==their creativity== freely. Dina Vierny, recognizing ==the immense talent== and the struggle ==these artists== endured, played a pivotal role in aiding ==their artistic aspirations==. \[...\]
>
> In this new chapter of his life, Yankilevsky found himself amidst a community of ==like-minded artists== who, despite diverse styles, shared a common goal—to break free from ==the confines of state-imposed artistic norms==, particularly socialist realism. \[...\]
>
> The move to Paris facilitated an environment where Yankilevsky could further explore and exhibit ==his distinctive artistic vision== without ==the constraints imposed by the Soviet regime==. Dina Vierny's unwavering support and commitment to the ==Russian avant-garde artists== played a crucial role in fostering a space where ==their creativity== could flourish, contributing to the rich tapestry of artistic expression in the vibrant cultural landscape of Paris. Vierny's commitment culminated in the groundbreaking exhibition "Russian Avant-Garde - Moscow 1973" at her Saint-Germain-des-Prés gallery, showcasing the ==diverse yet united front of non-conformist artists== challenging ==the artistic norms== of their time.

— From [this revision](https://en.wikipedia.org/wiki/Special:Diff/1205035512 "Special:Diff/1205035512") to [Vladimir Yankilevsky](https://en.wikipedia.org/wiki/Vladimir_Yankilevsky "Vladimir Yankilevsky")

## False ranges

When from... to... constructions are not used figuratively, they are used to indicate the lower and upper bounds of a scale. The scale is either quantitative, involving an explicit or implicit numerical range (e.g. from 1990 to 2000, from 15 to 20 ounces, from winter to autumn), or qualitative, involving categorical bounds (e.g. " from seed to tree ", " from mild to severe ", " from white belt to black belt "). The same constructions may be used to form a [merism](https://en.wikipedia.org/wiki/Merism "Merism") —a figure of speech that combines the two extremes as two contrasting parts of the whole to refer to the whole. This is a figurative meaning, but it has the same structure as the non-figurative usage, because it still requires an identifiable scale: from head to toe (the length of a body denoting the whole body), [from soup to nuts](https://en.wiktionary.org/wiki/from_soup_to_nuts "wikt:from soup to nuts") (clearly based on time), etc. This is *not* a false range.

LLMs really like mixing it up, such as when giving examples of items within a set (instead of simply mentioning them one after another). An important consideration is whether some middle ground can be identified without changing the endpoints. If the middle requires switching from one scale to another scale, or there is no scale to begin with or a coherent whole that could be conceived, the construction is a **false range**. LLMs often employ "figurative" (often simply: meaningless) " from... to..." constructions that purport to signify a scale, while the endpoints are loosely related or essentially unrelated things and no meaningful scale can be inferred. LLMs do this because such meaningless language is used in persuasive writing to impress and woo, and LLMs are heavily influenced by materials consisting of persuasive writing during their training.

**Examples**

> Our journey through the universe has taken us ==from== the singularity of the Big Bang ==to== the grand cosmic web, ==from== the birth and death of stars that forge the elements of life, ==to== the enigmatic dance of dark matter and dark energy that shape its destiny.
>
> \[...\]
>
> Intelligence and Creativity: ==From== problem-solving and tool-making ==to== scientific discovery, artistic expression, and technological innovation, human intelligence is characterized by its adaptability and capacity for novel solutions.
>
> \[...\]
>
> Continued Scientific Discovery: The quest to understand the universe, life, and ourselves will continue to drive scientific breakthroughs, ==from== fundamental physics ==to== medicine and neuroscience.

— From [Draft:The Cosmos Unveiled: A Grand Tapestry of Existence](https://en.wikipedia.org/wiki/Draft:The_Cosmos_Unveiled:_A_Grand_Tapestry_of_Existence "Draft:The Cosmos Unveiled: A Grand Tapestry of Existence")

## Title case

In section headings, AI chatbots strongly tend to consistently capitalize all main words ([title case](https://en.wikipedia.org/wiki/Title_case "Title case")).[^6]

**Examples**

> Thomas was born in Cochranville, Pennsylvania. \[...\]
>
> Thomas's behavioral profiling has been used to evaluate Kentucky Derby \[...\]
>
> Global Consulting
>
> Thomas's behavioral profiling has been used to evaluate Kentucky Derby and Breeders' Cup contenders. \[...\]
>
> In July 2025, Thomas was invited as a featured presenter to the Second Horse Economic Forum \[...\]
>
> Educational Programs
>
> Thomas is the founder of the Institute for Advanced Equine Studies \[...\]

— From [Draft:Kerry M. Thomas](https://en.wikipedia.org/wiki/Draft:Kerry_M._Thomas "Draft:Kerry M. Thomas")

[^6]: Russell, Jenna; Karpinska, Marzena; Iyyer, Mohit (2025). [*People who frequently use ChatGPT for writing tasks are accurate and robust detectors of AI-generated text*](https://aclanthology.org/2025.acl-long.267/). Proceedings of the 63rd Annual Meeting of the Association for Computational Linguistics (Volume 1: Long Papers). Vienna, Austria: Association for Computational Linguistics. pp. 5342– 5373. [arXiv](https://en.wikipedia.org/wiki/ArXiv_\(identifier\) "ArXiv (identifier)"):[2501.15654](https://arxiv.org/abs/2501.15654). [doi](https://en.wikipedia.org/wiki/Doi_\(identifier\) "Doi (identifier)"):[10.18653/v1/2025.acl-long.267](https://doi.org/10.18653%2Fv1%2F2025.acl-long.267). Retrieved 2025-09-05 – via [ACL Anthology](https://en.wikipedia.org/wiki/ACL_Anthology "ACL Anthology").

[^8]: ["10 Ways AI Is Ruining Your Students' Writing"](https://www.chronicle.com/article/10-ways-ai-is-ruining-your-students-writing). *Chronicle of Higher Education*. September 16, 2025.
