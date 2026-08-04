# Human review surface routing

The caller names the review artifacts; route each format to the user's preferred application while
keeping any rendered evidence current:

| Artifact | Human review surface |
|---|---|
| Markdown (`.md`) | Open in Typora |
| Word (`.docx`) | Open in LibreOffice Writer |
| Typst/TeX (`.typ`, `.tex`) | Open source in Neovim and keep Tinymist or a freshly rendered PDF preview visible |
| PDF/HTML/figures | Present the rendered output whenever the criteria or approved plan names it |

Use existing application skills or CLI launchers rather than duplicating editor automation. Source and
rendered output are complementary: source supports anchored edits; rendered output proves layout and
execution. Name the selected surfaces in the returned review result, alongside the receipt-selected
`{planFile, planHash}` they are bound to. TaskList is the live feedback queue and the returned result
is the user-visible account; there is no review ledger to record them in.
