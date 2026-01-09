// Stata analysis test
// This is a jupytext percent-format file

// %%
clear all
set more off

// %%
// Generate sample data
set obs 100
gen x = rnormal()
gen y = 2*x + rnormal()

// %%
// Run regression
regress y x
