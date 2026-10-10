import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parseFilingHistory, deriveDates } from './corp-history.ts'

// Synthetic fixture reproducing the live Filing History layout (invented entity; no real data).
const live = readFileSync(new URL('./fixtures/corp-full-synthetic.txt', import.meta.url), 'utf8')

test('fixture: row count, first and last rows, section stops at Important:', () => {
  const rows = parseFilingHistory(live)
  expect(rows).toHaveLength(28)
  expect(rows[0]).toEqual({ date: '03/10/2026', kind: 'EFFECTIVE', ref: '20260000001', type: 'BUSINESS ENTITY CERTIFICATES SEARCH', description: '' })
  expect(rows.at(-1)).toEqual({ date: '07/08/2015', kind: 'FILING', ref: '20150000019-75', type: 'AMENDED DESIGNATION;SERIES C PREFERRED STOCK', description: '' })
  expect(rows.some(r => /Important/.test(r.type + r.description))).toBe(false)
})

test('fixture: default, revocation and reinstatement dates are found by document name', () => {
  expect(deriveDates(parseFilingHistory(live))).toEqual({ last_default_date: '01/15/2021', last_revocation_date: '08/20/2020', last_reinstatement_date: '06/01/2019' })
})

const syn = `Filing History\n\nFiling Date\tFiling Type\tNumber\tDescription\tMisc.\n` +
  `05/01/2025\tFILING\tRef No.: 1\tPERMANENT REVOCATION\t\n04/30/2019\tFILING\tRef No.: 2\tDEFAULT NOTICE\t\n` +
  `06/01/2020\tFILING\tRef No.: 3\tREINSTATEMENT AFTER REVOCATION\t\n01/15/2022\tFILING\tRef No.: 4\tDEFAULT\t\nOfficers\n03/03/2003\tPresident`

test('synthetic: latest default, revocation, reinstatement; stops at Officers', () => {
  const rows = parseFilingHistory(syn)
  expect(rows).toHaveLength(4)
  expect(deriveDates(rows)).toEqual({ last_default_date: '01/15/2022', last_revocation_date: '05/01/2025', last_reinstatement_date: '06/01/2020' })
})

test('no section or no matches yield empty values', () => {
  expect(parseFilingHistory('Status: ACTIVE')).toEqual([])
  expect(deriveDates([])).toEqual({ last_default_date: '', last_revocation_date: '', last_reinstatement_date: '' })
})

test('Reinstatement-after-revocation type is not a revocation', () => {
  const d = deriveDates([{ date: '01/01/2021', type: 'Reinstatement after Revocation' }])
  expect(d.last_revocation_date).toBe('')
  expect(d.last_reinstatement_date).toBe('01/01/2021')
})
