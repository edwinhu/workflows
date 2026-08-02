// Every place the plugin version is spelled must agree — including the ones no other test
// reads.
//
// WHY THIS IS SEPARATE FROM public-extension-contract.test.ts
//   That suite enforces the four JSON version fields against its own TARGET_VERSION
//   constant. It cannot enforce the constant itself (it IS the constant), and it does not
//   look at the version embedded in its own test title. So a hand-bump could leave the
//   title stale forever and every suite would stay green while the file lied about what it
//   was checking. That is the same shape as the defect this repo has been chasing all
//   week: a check that runs without verifying the thing it claims to verify.
//
//   `scripts/bump-version.sh --check` reads all six sites out of the files themselves and
//   fails if they disagree or if one cannot be located (i.e. a file's shape changed and a
//   site silently stopped being tracked). Shelling out to it means the script stays the
//   single source of truth: add a version site there and this test picks it up for free.
import { execFileSync } from 'node:child_process'
import { describe, expect, test } from 'bun:test'

const ROOT = new URL('..', import.meta.url).pathname

function check() {
  try {
    return { out: execFileSync(`${ROOT}scripts/bump-version.sh`, ['--check'], { encoding: 'utf8', cwd: ROOT }), status: 0 }
  } catch (error) {
    return { out: `${error.stdout || ''}${error.stderr || ''}`, status: error.status ?? 1 }
  }
}

describe('plugin version sites', () => {
  test('all six agree, and every one is still locatable', () => {
    const { out, status } = check()
    expect(out, 'bump-version.sh --check must report agreement').toContain('OK: all six agree at')
    expect(status, `version sites disagree or went missing:\n${out}`).toBe(0)
  })

  test('the check actually inspects six distinct sites', () => {
    // Guards the guard: if a refactor collapses the site list, --check would trivially
    // "agree" over fewer things and this suite would keep passing while coverage shrank.
    const { out } = check()
    const sites = out.split('\n').filter(line => /^ {2}\S/.test(line))
    expect(sites).toHaveLength(6)
    for (const site of sites) expect(site).toMatch(/\b\d+\.\d+\.\d+$/)
  })
})
