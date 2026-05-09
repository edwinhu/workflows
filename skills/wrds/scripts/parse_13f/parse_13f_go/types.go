package main

// Row represents one holdings row in the output TSV.
type Row struct {
	FilePath             string
	Accession            string
	CIK                  string
	PeriodOfReport       string // YYYYMMDD
	FiledDate            string // YYYYMMDD
	FormType             string // 13F-HR, 13F-HR/A, 13F-NT, 13F-NT/A
	NameOfIssuer         string
	TitleOfClass         string
	CUSIP9               string // normalized 9-char uppercase
	CUSIP8               string // first 8 chars
	CUSIP6               string // first 6 chars (issuer)
	Value                int64  // in thousands of dollars
	Shares               int64
	SharesType           string // SH or PRN
	InvestmentDiscretion string // SOLE, DFND, OTR
	OtherManager         string // raw text
	VotingSole           int64
	VotingShared         int64
	VotingNone           int64
	CUSIPValid           bool
	IsAmendment          bool
	AmendmentType        string // RESTATEMENT, NEW HOLDINGS, or ""
	ParseMode            string // "xml" or "text"
}

// FilingMeta is one row in the manifest TSV (one per filing).
type FilingMeta struct {
	FilePath       string
	Accession      string
	CIK            string
	PeriodOfReport string
	FiledDate      string
	FormType       string
	CompanyName    string
	NRows          int
	ParseMode      string // "xml", "text", "notice"
	ParseStatus    string // "ok", "error", "skip"
	ErrorMsg       string
}

// ParseResult bundles the output of parsing a single filing.
type ParseResult struct {
	Rows []Row
	Meta FilingMeta
}

// TSV column order for holdings output.
var holdingsColumns = []string{
	"filepath", "accession", "cik", "period_of_report", "filed_date", "form_type",
	"name_of_issuer", "title_of_class",
	"cusip9", "cusip8", "cusip6", "value", "shares", "shares_type",
	"investment_discretion", "other_manager",
	"voting_sole", "voting_shared", "voting_none",
	"cusip_valid", "is_amendment", "amendment_type", "parse_mode",
}

// TSV column order for manifest output.
var manifestColumns = []string{
	"filepath", "accession", "cik", "period_of_report", "filed_date", "form_type",
	"company_name", "n_rows", "parse_mode", "parse_status", "error_msg",
}
