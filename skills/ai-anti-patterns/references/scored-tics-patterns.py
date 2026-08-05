"""Scored AI-tic patterns — GENERATED from the ai-tic linter's tics.yaml.
Do not hand-edit; regenerate via emit_patterns.py. Label carries severity
(sev1-5); every entry passed the ~0-human-rate gate against the law +
finance control corpora, so these flag AI defaults real authors don't write.
"""

# (regex, label) — label format: 'ai-tic·sev{N}·{id}'
_TIC_PATTERNS = [
    ("\\b(let'?s think step by step|breaking this down|to approach this systematically|here'?s my thought process|working through this logically)\\b", 'ai-tic·sev5·reasoning-chain-leak'),
    ("(?m)^(certainly[!,]|great question|absolutely[!,]|let'?s dive in|let'?s explore)\\b", 'ai-tic·sev5·chatbot-opener'),
    ('\\brich tapestry\\b', 'ai-tic·sev4·rich-tapestry'),
    ('\\bstands? as a testament to\\b', 'ai-tic·sev4·stands-as-testament'),
    ("\\bin today'?s (fast-paced|digital|ever-\\w+|rapidly)\\b", 'ai-tic·sev4·in-todays-fastpaced'),
    ('\\bfindings carry (significant )?implications\\b', 'ai-tic·sev4·findings-carry-implications'),
    ('\\bdelv\\w+ into the (intricac|complexit|nuanc)\\w+ of\\b', 'ai-tic·sev4·delve-into-intricacies'),
    ('\\b(while|although) [a-z ]{4,30} (is impressive|has made strides|shows promise|remains promising),', 'ai-tic·sev4·false-concession'),
    ('\\bthis (represents|symbolizes|reflects|speaks to) a (broader|larger|fundamental) (shift|trend|change|transformation)\\b', 'ai-tic·sev4·superficial-meaning-telling'),
    ('\\ba multifaceted (issue|challenge|problem|landscape|nature)\\b', 'ai-tic·sev3·multifaceted-noun'),
    ('\\bplays? a pivotal role in shaping\\b', 'ai-tic·sev3·plays-pivotal-role-shaping'),
    ('\\bnavigat\\w+ the complexit\\w+ of\\b', 'ai-tic·sev3·navigate-complexities-of'),
    ('\\bfrom [a-z]+ to [a-z]+, and everything in between\\b', 'ai-tic·sev3·false-range-sweep'),
    ('\\b(rule|statute|provision|section|act|law|reform|restriction|requirement|mandate|constraint)s?\\s+(should|would|will|may|might|does|do)?\\s*bites?\\b|\\bbites?\\s+hard(er|est)\\b', 'ai-tic·sev3·rule-bites'),
    ('\\bsharpest version of\\b', 'ai-tic·sev2·sharpest-version'),
    ('\\bbounds?\\s+(all of|the whole|everything|the entirety|the entire|the analysis|the inquiry|the conclusion|the discussion|much of)\\b', 'ai-tic·sev2·bound-abstraction'),
]
