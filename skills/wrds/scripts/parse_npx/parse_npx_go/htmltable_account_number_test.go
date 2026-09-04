package main

import "testing"

func TestHTMLFundLabelledAccountNumber(t *testing.T) {
	if !htmlFundLabelled("Account Number: Putnam Asset Allocation: Balanced Portfolio") {
		t.Fatal("Account Number: line not read as a fund label")
	}
	if htmlFundLabelled("Account: 12345") {
		t.Fatal("a bare Account: line must not be a fund label")
	}
}
