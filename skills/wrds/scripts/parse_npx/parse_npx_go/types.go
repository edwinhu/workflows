package main

// VoteRow is one row of votes.tsv.gz: one <voteRecord> in the modern XML era,
// one proposal line in the legacy text era.
type VoteRow struct {
	FilePath                 string
	Accession                string
	CIK                      string
	PeriodOfReport           string // YYYYMMDD
	FiledDate                string // YYYYMMDD
	FormType                 string
	RegistrantName           string
	SeriesID                 string
	ClassIDs                 string
	FundName                 string
	IssuerName               string
	CUSIP                    string
	ISIN                     string
	FIGI                     string
	Ticker                   string
	MeetingDate              string // YYYYMMDD
	MeetingType              string
	RecordDate               string // YYYYMMDD
	ItemSeq                  string
	VoteDescription          string
	VoteCategories           string // multiple categories joined with ";"
	OtherVoteDescription     string
	VoteSource               string
	SharesVotedTotal         string
	SharesOnLoan             string
	HowVoted                 string
	SharesVoted              string
	ManagementRecommendation string
	OtherManagers            string // multiple managers joined with ";"
	VoteOtherInfo            string
	ParseMode                string // xml | text | none
	Layout                   string
}

// FilingMeta is one row of manifest.tsv.gz, one per filing.
type FilingMeta struct {
	FilePath       string
	Accession      string
	CIK            string
	PeriodOfReport string
	FiledDate      string
	FormType       string
	CompanyName    string
	NRows          int
	ParseMode      string // xml | text | none
	Layout         string
	ParseStatus    string // ok | error | skip
	ErrorMsg       string

	// SeriesDecls carries the header's series declarations to the layout
	// parsers, which are the only layer that knows which series a given vote
	// belongs to. It is not a manifest column and is not serialized.
	SeriesDecls []SeriesDecl
}

// ParseResult bundles the output of parsing a single filing.
type ParseResult struct {
	Rows []VoteRow
	Meta FilingMeta
}

// SeriesClass is one <SERIES-ID>/<CLASS-CONTRACT-ID>/<CLASS-CONTRACT-TICKER-SYMBOL>
// triple from the SGML header. An N-PX registrant files for dozens at once.
type SeriesClass struct {
	SeriesID string
	ClassID  string
	Ticker   string
}

// SeriesDecl is one series as the SGML header DECLARES it: the id, the name the
// header spells for it, and the class contracts listed under it. Unlike the
// triples above there is exactly one per <SERIES-ID>, so a series declaring no
// class contract still appears.
//
// The name is what lets a legacy layout attribute a vote: the body prints a fund
// heading and the header declares the same fund by name, so the name is the only
// bridge between a vote and its series id.
type SeriesDecl struct {
	SeriesID string
	Name     string
	ClassIDs []string
}

// MultiValueSep joins repeated child values into one TSV cell.
const MultiValueSep = ";"

// voteColumns is the authoritative column order of votes.tsv.gz.
// VoteRow.TSV must serialize in exactly this order, and no header row is written.
var voteColumns = []string{
	"filepath", "accession", "cik", "period_of_report", "filed_date", "form_type",
	"registrant_name", "series_id", "class_ids", "fund_name",
	"issuer_name", "cusip", "isin", "figi", "ticker",
	"meeting_date", "meeting_type", "record_date", "item_seq",
	"vote_description", "vote_categories", "other_vote_description", "vote_source",
	"shares_voted_total", "shares_on_loan",
	"how_voted", "shares_voted", "management_recommendation",
	"other_managers", "vote_other_info", "parse_mode", "layout",
}

// manifestColumns is the authoritative column order of manifest.tsv.gz.
var manifestColumns = []string{
	"filepath", "accession", "cik", "period_of_report", "filed_date", "form_type",
	"company_name", "n_rows", "parse_mode", "layout", "parse_status", "error_msg",
}

// preRunHooks are consulted by main() immediately after flag.Parse(). The first
// hook returning handled=true takes over the run and main exits with its code
// without opening the vote/manifest writers. This is how an alternate mode
// (-shard) is wired in from its own file without editing main.go.
var preRunHooks []func() (handled bool, code int)
