---
name: typst-computed-values
description: "Typst files with calculations, computed values, compound interest, percentages, growth rates"
---

# IRON LAW: NO Hardcoded Calculations in Typst

**Hardcoding a calculated number is LYING to the user.**

Typst is a full programming language. Use `calc` module. Always.

## Rationalization Table

| Excuse | Reality |
|--------|---------|
| "I'm confident in this calculation" | LLMs hallucinate numbers. You got $31M wrong when it should be $3.1M. |
| "It's just a simple calculation" | Simple calculations are EXACTLY where errors hide. 1.1^12 ≠ 31. |
| "The user won't notice" | The user WILL notice when teaching students wrong math. |
| "I'll verify it later" | You won't. Compute it now. |
| "It's close enough" | Close enough is WRONG. $31M vs $3.1M is 10x off. |
| "Typst syntax is complex" | `calc.pow(1.1, 12)` is not complex. |

## Red Flags - STOP Immediately

If you catch yourself:
- Typing a dollar amount followed by "million/billion/trillion" → **STOP**
- Typing a percentage with decimals (23.47%) → **STOP**
- Typing "after X years you have $Y" → **STOP**
- Typing any number that results from multiplication/division/exponents → **STOP**

**Delete what you typed. Write a `#let` and `calc.` expression instead.**

## The Pattern

```typst
// 1. Define inputs as variables
#let start = 1e6      // $1 million
#let rate = 1.1       // 10% monthly growth
#let periods = 12     // 1 year

// 2. Create formatter for output
#let fmt-big(n) = {
  if n >= 1e12 { [\$#calc.round(n / 1e12, digits: 1) trillion] }
  else if n >= 1e9 { [\$#calc.round(n / 1e9, digits: 1) billion] }
  else if n >= 1e6 { [\$#calc.round(n / 1e6, digits: 1) million] }
  else { [\$#calc.round(n, digits: 0)] }
}

// 3. Use computed expressions inline
After one year: #fmt-big(start * calc.pow(rate, periods))
```

## Key `calc` Functions

| Function | Example |
|----------|---------|
| `calc.pow(base, exp)` | `calc.pow(1.1, 12)` → 3.138... |
| `calc.round(n, digits: d)` | `calc.round(3.14159, digits: 2)` → 3.14 |
| `calc.sqrt(n)` | `calc.sqrt(144)` → 12 |
| `calc.abs(n)` | `calc.abs(-5)` → 5 |

## Verification Gate

After writing computed values:

1. **IDENTIFY**: What calculation did you compute?
2. **RUN**: `python3 -c "print(1e6 * 1.1**12)"` to verify
3. **READ**: Does Python output match expectation?
4. **VERIFY**: Does Typst expression use same formula?
5. **CLAIM**: Only then state the values are correct

## Exceptions (ONLY these)

- Primary source data: "Company reported $5.2B revenue"
- Historical facts: "Founded in 1920"
- Trivially obvious: "half of 10"

Everything else: **COMPUTE IT**.
