# ---
# jupyter:
#   jupytext:
#     formats: ipynb,R:percent
#     text_representation:
#       extension: .R
#       format_name: percent
#       format_version: '1.3'
#   kernelspec:
#     display_name: R
#     language: R
#     name: ir
# ---

# %% [markdown]
# # R Statistical Analysis Template
#
# This template demonstrates jupytext percent format for R.
# Reads data from Python pipeline (parquet) and performs statistical analysis.

# %%
# Load libraries
library(tidyverse)
library(arrow)
library(broom)

# %% [markdown]
# ## Data Loading
#
# Read parquet file created by Python preprocessing step.

# %%
# Read data from Python pipeline
df <- read_parquet("data/processed/processed.parquet")

# Inspect data
glimpse(df)

# %%
# Summary statistics
summary(df)

# %% [markdown]
# ## Exploratory Analysis

# %%
# Distribution of numeric variables
df |>
    select(where(is.numeric)) |>
    pivot_longer(everything()) |>
    ggplot(aes(x = value)) +
    geom_histogram(bins = 30) +
    facet_wrap(~name, scales = "free") +
    theme_minimal()

# %% [markdown]
# ## Statistical Modeling

# %%
# Example: Linear regression
# model <- lm(outcome ~ predictor1 + predictor2, data = df)
# summary(model)

# %%
# Tidy model output for export
# results <- tidy(model) |>
#     mutate(
#         conf.low = estimate - 1.96 * std.error,
#         conf.high = estimate + 1.96 * std.error
#     )
# print(results)

# %% [markdown]
# ## Export Results
#
# Save results back to parquet for Python aggregation.

# %%
# Example: Export model coefficients
# write_parquet(results, "results/model_coefficients.parquet")

# Export summary statistics
summary_stats <- df |>
    summarise(across(where(is.numeric), list(
        mean = ~mean(., na.rm = TRUE),
        sd = ~sd(., na.rm = TRUE),
        n = ~sum(!is.na(.))
    )))

write_parquet(summary_stats, "results/summary_stats.parquet")
print("Results exported to parquet")
