# ---
# jupyter:
#   kernelspec:
#     display_name: R
#     language: R
#     name: ir
# ---

# %% [markdown]
# # R Analysis Test

# %%
library(tidyverse)

# %%
# Create a simple dataframe
df <- data.frame(
  x = 1:10,
  y = rnorm(10)
)

# %%
# Plot the data
ggplot(df, aes(x = x, y = y)) +
  geom_point() +
  theme_minimal()
