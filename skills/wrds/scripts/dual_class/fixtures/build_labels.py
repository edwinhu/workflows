"""Provenance for fixtures/labels.csv (run once; the CSV is the artifact).

Sources (hidden-figures/scratch/borderline3): jkl2_labels.csv (30, joined to jkl2_sample30.csv = gvkey,fyear,cik,form,path of jkl2_sample30.parquet, on
gvkey+fyear for cik/form/path; the label note is the quote), jkl3/labels120.csv (120), jkl4/labels120.csv (120).
Labels: dual | single | unres. 'unres' = the labeller could not decide from the stored text; excluded from scoring.
Usage: python build_labels.py <borderline3_dir> <out.csv>
"""
import csv, re, sys
from pathlib import Path


def accession(path):
    m = re.search(r'(\d{10}-\d{2}-\d{6})', path)
    assert m, path
    return m.group(1)


def main(root, out):
    root = Path(root)
    rows = []
    s30 = {(r['gvkey'], r['fyear']): r for r in csv.DictReader(open(root / 'jkl2_sample30.csv'))}
    for r in csv.DictReader(open(root / 'jkl2_labels.csv')):
        s = s30[(r['gvkey'], r['fyear'])]
        rows.append(dict(cik=s['cik'].lstrip('0'), fyear=r['fyear'], form=s['form'], path=s['path'],
                         label=r['my_label'], quote=r['note'], source_set='jkl2'))
    for name in ('jkl3', 'jkl4'):
        for r in csv.DictReader(open(root / name / 'labels120.csv')):
            rows.append(dict(cik=r['cik'], fyear=r['fyear'], form=r['form'], path=r['path'], label=r['label'],
                             quote=r['quote'], source_set=name))
    for r in rows:
        r['filing_id'] = accession(r['path'])
    assert len({r['filing_id'] for r in rows}) == len(rows), 'duplicate filing_id'
    rows.sort(key=lambda r: r['filing_id'])
    cols = ['filing_id', 'cik', 'fyear', 'form', 'path', 'label', 'quote', 'source_set']
    with open(out, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols, lineterminator='\n')
        w.writeheader(); w.writerows(rows)
    print(len(rows), 'rows ->', out)


if __name__ == '__main__':
    main(*sys.argv[1:3])
