/**
 * Best-effort classification of a Bash command line as "mutates files on disk".
 *
 * SCOPE, AFTER THE INVERSION — READ THIS FIRST
 *   This module NO LONGER decides whether a restricted actor may run a command. That question moved
 *   to `_bash_allowlist.ts`, which denies by default and admits only recognized read-only
 *   invocations, because the denylist below never converged: four rounds of enumeration produced
 *   four rounds of fresh live ALLOWs. `implementer-identity-gate` does not import this file.
 *
 *   What remains is `orchestrator-mutation-guard`'s `ds`/`dev`/`work` branch, and that is genuinely
 *   different work rather than a duplicate mechanism. That guard is skill-scoped and receipt-blind:
 *   it fires for main chat inside those skills at every lifecycle stage, INCLUDING before any plan
 *   is approved, where the identity gate is deliberately inert. A denylist is the right shape there
 *   because the actor is doing open-ended pre-approval work and an allowlist would block it — and it
 *   is defensible there because it is a second layer over a stage the allowlist does not cover, not
 *   the sole barrier over one it does.
 *
 *   Do not reintroduce it as an admission test anywhere. Everything below about undecidability is
 *   still true, and it is exactly why it cannot be one.
 *
 * WHY THIS EXISTS
 *   The actor-separation gates originally matched only `Write|Edit|NotebookEdit`. A conversation that
 *   had already APPROVED a plan could therefore run `echo payload > src/a.js` through the Bash tool
 *   and write arbitrary project code with no gate firing at all — measured live across all six
 *   governed workflows: `dev` and `work` admitted 18/18 attempted techniques, `ds` 10/18. The
 *   allowlist branches (`writing`, `workshop`, `workflow-creator`) were the only closed ones.
 *
 * WHAT THIS CAN AND CANNOT DO — READ THIS BEFORE TRUSTING IT
 *   Deciding whether an arbitrary shell command writes a file is NOT decidable from the command line.
 *   A command's effect lives inside the program it names, and the gate cannot see inside `make`,
 *   `cargo build`, `./scripts/build.sh`, `npm run something`, or any project-local binary. This
 *   classifier is therefore a DENY-BIASED DENYLIST plus an unclassifiability rule, not a proof:
 *
 *   CAUGHT
 *     - output redirection to a path (`>`, `>>`, `&>`, `>|`, `N>`), including inside a here-doc header
 *     - named file-mutating utilities (see MUTATING_COMMANDS), through `sudo`/`env`/`nohup`/`xargs`
 *       wrappers and leading `VAR=value` assignments
 *     - in-place edit flags (`sed -i`, `perl -pi`, `ruby -i`)
 *     - interpreter one-liners (`python -c`, `node -e`, `bun -e`, `perl -e`, ...) — the code is opaque,
 *       so it is treated as unclassifiable and reported as mutating
 *     - shell metaprogramming that hides the real command: command substitution `$(...)` / backticks,
 *       process substitution `<(...)`, `eval`, `source`/`.`, and pipes into a mutating sink such as
 *       `tee`/`dd`/`patch`
 *     - git subcommands that rewrite worktree CONTENT (see MUTATING_GIT for the precise claim)
 *     - the wrapped forms of all of the above: `timeout 5 rm f`, `nice -n 10 cp a b`, `exec rm f`,
 *       `timeout 5 sh -c '...'` (see WRAPPER_SPECS), and the quoted/escaped spellings of a command
 *       name (`c'p'`, `r\m`) or of a redirection target (`>"f"`)
 *
 *   NOT CAUGHT (the residue — document it, do not paper over it)
 *     - any opaque executable that writes files: `make`, `cargo build`, `go build`, `./build.sh`,
 *       `npm run build`, a project script, a compiled binary. These are indistinguishable from
 *       read-only commands at the command-line level and are deliberately admitted, because denying
 *       every unrecognized command would deny the orchestrator's own test and check runs.
 *     - a mutating utility invoked under a name this list does not know (a shell alias, a wrapper
 *       script, a renamed copy of `cp`)
 *     - an unknown WRAPPER, and an unknown value-taking OPTION of a known wrapper whose value is a
 *       separate non-numeric word. The flag tables are enumerations, so they are as incomplete as
 *       any enumeration; the numeric backstop in `effectiveWords` covers the common shape only.
 *     - anything reached through shell expansion the gate does not evaluate: variables (`$CMD f`),
 *       globs, aliases, functions, and `$PATH` ordering
 *     - writes performed by a long-running process started earlier
 *
 *   None of this is fixable by adding more names. The question — "does this command line write a
 *   file" — is undecidable, and the value of this module is that it makes the cheap bypasses cost
 *   something, not that it closes them all.
 *
 *   The residue is real. This module raises the cost of the bypass from "type one `>` redirect" to
 *   "ship an opaque executable that writes the file"; it does not eliminate it. The invariant the
 *   surrounding gates can honestly claim is documented in `workflows/lib/approved-artifact.ts`.
 */

/** Utilities whose ordinary purpose is to create, overwrite, move, or destroy file content. */
const MUTATING_COMMANDS = new Set([
  "tee", "dd", "truncate", "install", "patch", "shred",
  "cp", "mv", "rm", "rmdir", "ln", "touch", "chmod", "chown", "chgrp", "mktemp",
  "tar", "unzip", "zip", "gzip", "gunzip", "bzip2", "bunzip2", "xz", "unxz", "rsync", "scp",
  "curl", "wget",
  "eval", "source", ".",
]);

/**
 * Read-only INVOCATIONS of commands that are mutating by default.
 *
 * Several entries above have an everyday inspection form that writes nothing, and the classifier is
 * wired into `dev`/`work` orchestration, where those forms are ordinary work. Flagging the command
 * NAME alone denied `curl -I`, `wget --spider`, `tar -tf`, `unzip -l`, `gzip -cd`, `mktemp -u`, and
 * `rsync -n` — all read-only, all measured as denials before this table existed.
 *
 * Each predicate answers "is THIS invocation read-only", and defaults to false: an unrecognized
 * option shape keeps the deny. Redirection is judged separately, so `curl url > f` is still caught.
 */
const READ_ONLY_FORMS: Record<string, (rest: string[]) => boolean> = {
  // Writes to stdout unless explicitly told to write a file, save headers, or save cookies.
  curl: rest => !rest.some(token =>
    /^--(output|remote-name|remote-name-all|remote-header-name|create-dirs|output-dir|dump-header|cookie-jar|trace|trace-ascii|etag-save|xattr)\b/.test(token)
    || (/^-[A-Za-z]+$/.test(token) && /[oOJD]/.test(token.slice(1)))
    || /^-[oODJ]./.test(token)),
  // Writes `./index.html` by DEFAULT, so read-only needs a positive signal, not the absence of one.
  wget: rest => rest.includes("--spider")
    || rest.includes("-O-") || rest.includes("--output-document=-")
    || rest.some((token, index) => token === "-O" && rest[index + 1] === "-"),
  tar: rest => {
    if (rest.some(token => /^--(extract|get|create|append|update|delete|concatenate|catenate)\b/.test(token))) return false;
    if (rest.some(token => /^--(list|test-label)\b/.test(token))) return true;
    // `-tf archive` and the old-style `tf archive` both carry their mode as bundled letters.
    const modes = rest.filter(token => /^-?[A-Za-z]+$/.test(token)).map(token => token.replace(/^-/, ""));
    return !modes.some(mode => /[xcurAd]/.test(mode)) && modes.some(mode => mode.includes("t"));
  },
  unzip: rest => rest.some(token => /^-[A-Za-z]*[ltvzp]/.test(token)),
  mktemp: rest => rest.some(token => token === "--dry-run" || /^-[A-Za-z]*u/.test(token)),
  rsync: rest => rest.some(token => token === "--dry-run" || token === "--list-only" || /^-[A-Za-z]*n/.test(token)),
};
// `-c/--stdout` writes to stdout, `-l/--list` lists, `-t/--test` verifies: none touch the filesystem.
for (const name of ["gzip", "gunzip", "bzip2", "bunzip2", "xz", "unxz"]) {
  READ_ONLY_FORMS[name] = rest => rest.some(token =>
    /^--(stdout|to-stdout|list|test)\b/.test(token) || /^-[A-Za-z0-9]*[clt]/.test(token));
}

/** Interpreters that execute code supplied on the command line: the body is opaque to this gate. */
const INTERPRETERS = new Set([
  "python", "python2", "python3", "node", "bun", "deno", "ruby", "perl", "php", "Rscript", "R",
  "osascript", "bash", "sh", "zsh", "ksh", "dash", "ash", "busybox",
  // Present-day scripting runtimes that are just as capable of writing a file as `node -e`.
  "lua", "luajit", "qjs", "tsx", "ts-node", "julia", "elixir", "groovy", "scala",
]);
const EVAL_FLAGS = new Set(["-c", "-e", "-E", "--eval", "-pe", "-ne", "-nE", "-pE", "--exec", "--command"]);

/**
 * awk takes its program positionally, so `-e` detection misses `awk 'BEGIN{print "x" > "f"}'` —
 * and the quote-masking that finds ordinary redirection deliberately blanks that program text.
 * Reading the program for its own output operators keeps the common read-only `awk '{print $1}'`
 * idiom usable while catching the awk-internal write.
 */
const AWK = new Set(["awk", "gawk", "mawk", "busybox"]);

/**
 * git subcommands that rewrite tracked file CONTENT in the worktree.
 *
 * THE PRECISE CLAIM, BECAUSE THE LOOSE ONE WAS INDEFENSIBLE
 *   This set is NOT "git subcommands that mutate". `add`, `commit`, `push`, `tag`, `fetch`,
 *   `branch`, `update-index`, and `hash-object -w` all mutate something real — the index, the object
 *   database, refs, or a remote — and calling them non-mutating was wrong as written.
 *
 *   What this classifier is for is narrower and is the only thing the surrounding gates claim: does
 *   the command change the CONTENT OF FILES IN THE WORKTREE, i.e. can it inject or destroy source
 *   the approver is forbidden to write directly. Index, ref, object-database, and remote state
 *   cannot do that — `git commit` records bytes that are already on disk and were themselves gated
 *   when they were written — so those subcommands are deliberately OUT OF SCOPE here rather than
 *   silently blessed. Publishing and history rewriting are governed elsewhere, not by this denylist.
 *
 *   Subcommands that DO land bytes in the worktree belong here even when their usual purpose is
 *   navigation: `switch` and `bisect` replace tracked files wholesale, `submodule` and `worktree`
 *   materialize whole trees, `clone` and `sparse-checkout` write working files, and
 *   `format-patch`/`archive`/`bundle` emit files at a path of the caller's choosing.
 */
const MUTATING_GIT = new Set([
  "checkout", "switch", "restore", "apply", "clean", "reset", "rm", "mv", "stash",
  "revert", "cherry-pick", "merge", "rebase", "pull", "am", "bisect",
  "submodule", "worktree", "sparse-checkout", "clone", "filter-branch",
  "format-patch", "archive", "bundle",
]);

/**
 * Wrappers that delegate to another command, with the options each one consumes.
 *
 * WHY THE FLAG TABLE, RATHER THAN "SKIP TOKENS STARTING WITH -"
 *   The original loop stripped consecutive `-flag` tokens and stopped at the first non-flag word, so
 *   any wrapper whose flag value is a SEPARATE token handed the classifier the VALUE as the command
 *   name. Measured as live ALLOWs end to end against an APPROVED `dev` receipt, from the approving
 *   actor: `timeout 5 rm src/a.js`, `timeout 5s cp /etc/hosts src/a.js`, `nice -n 10 cp ...`,
 *   `ionice -c 2 cp ...`, `stdbuf -o L cp ...`, and `timeout 5 sh -c "echo payload > src/a.js"` —
 *   the last of which also defeated interpreter detection, because `sh` never became the head word.
 *
 *   `operands` is for a wrapper's own mandatory positional argument: `timeout` takes a DURATION
 *   before the command, which is a non-flag word and therefore stopped the old loop dead.
 */
type WrapperSpec = { valueFlags: ReadonlySet<string>; operands: number };
const WRAPPER_SPECS: Readonly<Record<string, WrapperSpec>> = {
  sudo: { valueFlags: new Set(["-u", "--user", "-g", "--group", "-p", "--prompt", "-C", "--close-from", "-h", "--host", "-U", "--other-user", "-r", "--role", "-t", "--type", "-D", "--chdir"]), operands: 0 },
  doas: { valueFlags: new Set(["-u", "-C", "-a"]), operands: 0 },
  command: { valueFlags: new Set(), operands: 0 },
  env: { valueFlags: new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string"]), operands: 0 },
  nohup: { valueFlags: new Set(), operands: 0 },
  // `exec` replaces the shell with the named command; it is a wrapper in every way that matters.
  exec: { valueFlags: new Set(["-a"]), operands: 0 },
  xargs: { valueFlags: new Set(["-I", "-n", "--max-args", "-P", "--max-procs", "-d", "--delimiter", "-s", "--max-chars", "-L", "--max-lines", "-E", "-a", "--arg-file"]), operands: 0 },
  time: { valueFlags: new Set(["-o", "--output", "-f", "--format"]), operands: 0 },
  nice: { valueFlags: new Set(["-n", "--adjustment"]), operands: 0 },
  ionice: { valueFlags: new Set(["-c", "--class", "-n", "--classdata", "-p", "--pid", "-P", "--pgid", "-u", "--uid"]), operands: 0 },
  timeout: { valueFlags: new Set(["-s", "--signal", "-k", "--kill-after"]), operands: 1 },
  stdbuf: { valueFlags: new Set(["-i", "--input", "-o", "--output", "-e", "--error"]), operands: 0 },
};

export type BashMutation = { mutating: boolean; reason: string };

const CLEAN: BashMutation = { mutating: false, reason: "" };
const flag = (reason: string): BashMutation => ({ mutating: true, reason });

/**
 * Strip quoted spans so operators INSIDE a quoted literal are not read as shell syntax.
 *
 * LENGTH IS PRESERVED CHARACTER FOR CHARACTER, AND THAT IS LOad-BEARING: `simpleCommands` finds its
 * cut points in the masked string and then slices the RAW command at those offsets. An earlier
 * version emitted nothing for a backslash escape, consuming two characters and producing one fewer,
 * which desynchronized every offset after the first escape. Live ALLOW that opened:
 * `echo a\ b && rm src/a.js` — the `&&` cut landed one character early, so the second simple command
 * parsed as `& rm src/a.js` with `&` as its head word and the `rm` was never seen.
 */
function stripQuoted(command: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote === null && ch === "\\") { i += 1; out += i < command.length ? "  " : " "; continue; }
    if (quote === null && (ch === '"' || ch === "'")) { quote = ch; out += " "; continue; }
    if (quote !== null && ch === quote) { quote = null; out += " "; continue; }
    // Inside single quotes nothing expands; inside double quotes `$(` and backticks still do, and
    // the substitution check below runs against the RAW command precisely for that reason.
    out += quote === null ? ch : " ";
  }
  return out;
}

/** Split a command line into simple commands on `&&`, `||`, `;`, `|`, and newlines. */
function simpleCommands(command: string): string[] {
  const masked = stripQuoted(command);
  const cuts: number[] = [];
  for (let i = 0; i < masked.length; i += 1) {
    const two = masked.slice(i, i + 2);
    if (two === "&&" || two === "||") { cuts.push(i, i + 2); i += 1; continue; }
    if (masked[i] === ";" || masked[i] === "|" || masked[i] === "\n" || masked[i] === "&") cuts.push(i, i + 1);
  }
  const parts: string[] = [];
  let start = 0;
  for (let c = 0; c < cuts.length; c += 2) { parts.push(command.slice(start, cuts[c])); start = cuts[c + 1]; }
  parts.push(command.slice(start));
  return parts.map(part => part.trim()).filter(Boolean);
}

/**
 * Remove shell quoting from one word.
 *
 * Stripping only a leading and trailing quote left the shell's ordinary ways of spelling a command
 * name unrecognized: `c'p' /etc/hosts src/a.js` and `r\m src/a.js` both reached the classifier with
 * head words `c'p'` and `r\m`, matched nothing, and were allowed.
 */
function unquoteWord(word: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < word.length; i += 1) {
    const ch = word[i];
    if (quote !== "'" && ch === "\\") { i += 1; if (i < word.length) out += word[i]; continue; }
    if (quote === null && (ch === '"' || ch === "'")) { quote = ch; continue; }
    if (quote !== null && ch === quote) { quote = null; continue; }
    out += ch;
  }
  return out;
}

/** Tokenize a simple command, resolving each word's quoting so the head word is the real name. */
function words(simple: string): string[] {
  return simple.split(/\s+/).filter(Boolean).map(unquoteWord).filter(Boolean);
}

/**
 * Mask a command for REDIRECTION analysis: quote delimiters vanish and shell operators inside a
 * quoted literal are neutralized, but the quoted TEXT survives.
 *
 * `stripQuoted` blanks quoted content entirely, which is right for finding command separators and
 * wrong here: `printf payload >"src/a.js"` left an empty redirection target, and an empty target is
 * how `2>&1` presents, so the write was skipped as plumbing and allowed. Keeping the text means the
 * target reads as `src/a.js` and is caught, while `>"/dev/null"` still reads as `/dev/null` and is
 * still correctly ignored.
 */
function maskForRedirect(command: string): string {
  const OPERATOR = /[<>&|;$()`\n]/;
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote === null && ch === "\\") { i += 1; out += "X"; continue; }
    if (quote === null && (ch === '"' || ch === "'")) { quote = ch; continue; }
    if (quote !== null && ch === quote) { quote = null; continue; }
    out += quote !== null && OPERATOR.test(ch) ? "X" : ch;
  }
  return out;
}

/**
 * Redirection that lands in a FILE. `>/dev/null`, `>&2`, and `2>&1` are pure plumbing and are the
 * overwhelmingly common shape in read-only commands, so they are not treated as mutations.
 */
function redirectsToFile(simple: string): boolean {
  const masked = maskForRedirect(simple);
  const pattern = /(?:^|[^\\<>&0-9])([0-9]*)(&?>>?\|?)\s*([^\s|;&]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(masked)) !== null) {
    const target = match[3];
    if (target.startsWith("&")) continue;            // fd duplication: `>&2`
    if (!target) continue;                            // `2>&1` leaves an empty target after the mask
    if (/^\/dev\/(null|stderr|stdout|fd\/[0-9]+)$/.test(target)) continue;
    return true;
  }
  // Here-doc / here-string bodies are data, but the header may still redirect: `cat > f <<EOF`.
  return false;
}

/** Resolve the effective command name of a simple command, seeing through wrappers and VAR=. */
function effectiveWords(simple: string): string[] {
  let tokens = words(simple);
  for (let depth = 0; depth < 8; depth += 1) {
    while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens = tokens.slice(1);
    if (!tokens.length) return tokens;
    const head = tokens[0].split("/").pop() ?? tokens[0];
    const spec = WRAPPER_SPECS[head];
    if (!spec) return [head, ...tokens.slice(1)];
    tokens = tokens.slice(1);
    // Consume the wrapper's own options, taking each known value-carrying flag's SEPARATE argument
    // with it so the value can never be mistaken for the wrapped command name.
    while (tokens.length && tokens[0].startsWith("-") && tokens[0] !== "--") {
      tokens = tokens.slice(spec.valueFlags.has(tokens[0]) ? 2 : 1);
    }
    if (tokens[0] === "--") tokens = tokens.slice(1);
    for (let n = 0; n < spec.operands && tokens.length; n += 1) tokens = tokens.slice(1);
    // Backstop for a value-carrying option this table does not know: a bare number or a duration
    // cannot be a command name, so it is that option's argument, not the command.
    while (tokens.length && /^[0-9]+(?:\.[0-9]+)?[smhd]?$/.test(tokens[0])) tokens = tokens.slice(1);
  }
  return tokens;
}

function classifySimple(simple: string): BashMutation {
  if (redirectsToFile(simple)) return flag(`redirects output to a file: ${simple}`);
  const tokens = effectiveWords(simple);
  if (!tokens.length) return CLEAN;
  const [name, ...rest] = tokens;
  if (MUTATING_COMMANDS.has(name)) {
    const readOnlyForm = READ_ONLY_FORMS[name];
    if (!readOnlyForm || !readOnlyForm(rest)) return flag(`invokes the file-mutating command \`${name}\``);
  }
  if (name === "git" && rest.length && MUTATING_GIT.has(rest[0])) return flag(`invokes \`git ${rest[0]}\`, which rewrites worktree content`);
  if (name === "sed" && rest.some(token => token === "-i" || /^-i\S/.test(token) || (/^-[a-zA-Z]+$/.test(token) && token.includes("i")))) return flag("invokes `sed -i`, which edits files in place");
  if ((name === "perl" || name === "ruby") && rest.some(token => /^-[a-zA-Z]*i/.test(token))) return flag(`invokes \`${name} -i\`, which edits files in place`);
  if (INTERPRETERS.has(name) && rest.some(token => EVAL_FLAGS.has(token))) return flag(`runs an inline \`${name}\` program, whose file effects are opaque to this gate`);
  if (AWK.has(name) && /[^-\d]>|system\(|close\(|print\s*>/.test(rest.join(" "))) return flag(`runs an \`${name}\` program that writes through its own output redirection`);
  return CLEAN;
}

/**
 * Classify a whole command line. Deny-biased: anything this cannot read is reported as mutating.
 */
export function classifyBashMutation(command: string): BashMutation {
  const trimmed = String(command ?? "").trim();
  if (!trimmed) return CLEAN;
  // Command substitution can run an arbitrary hidden command; the gate cannot see through it.
  const masked = stripQuoted(trimmed);
  if (/\$\(|`/.test(trimmed.replace(/'[^']*'/g, ""))) return flag("uses command substitution, whose effects this gate cannot inspect");
  // Process substitution runs a whole command in a subshell that never becomes a head word:
  // `cat <(touch src/a.js)` reached the classifier as a plain `cat` and was allowed.
  if (/[<>]\(/.test(masked)) return flag("uses process substitution, which runs a command this gate cannot inspect");
  if (/<<-?\s*['"]?\w/.test(masked) && />/.test(masked)) return flag("feeds a here-document into a redirection");
  for (const simple of simpleCommands(trimmed)) {
    const verdict = classifySimple(simple);
    if (verdict.mutating) return verdict;
  }
  return CLEAN;
}
