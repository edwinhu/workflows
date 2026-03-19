# Structured Delegation Template

Template for delegating work to Task agents with clear contracts.

Based on oh-my-opencode's structured delegation pattern.

## Template Structure

Every delegation MUST include these sections:

1. **TASK** - What to do (1-2 sentences)
2. **EXPECTED OUTCOME** - Success criteria (bullet list)
3. **REQUIRED SKILLS** - Why this agent (justification)
4. **REQUIRED TOOLS** - What they'll need
5. **MUST DO** - Non-negotiable constraints
6. **MUST NOT DO** - Hard blocks
7. **CONTEXT** - Parent session state

## Full Template

```markdown
# TASK

[Clear, specific task description in 1-2 sentences]

## EXPECTED OUTCOME

You will have successfully completed this task when:
- [Concrete success criterion 1]
- [Concrete success criterion 2]
- [Concrete success criterion 3]

## REQUIRED SKILLS

This task requires:
- [Skill 1: Why it's needed]
- [Skill 2: Why it's needed]

This is why you were chosen for this task: [Justification]

## REQUIRED TOOLS

You will need these tools:
- Read: To examine existing code
- Grep: To find patterns
- Write: To create new files
- [Other tools as needed]

**Tools denied:** [List tools this agent cannot use, if any]

## MUST DO

These are non-negotiable requirements:
- [ ] Requirement 1
- [ ] Requirement 2
- [ ] Requirement 3

## MUST NOT DO

Hard blocks - these will cause task failure:
- ❌ Block 1
- ❌ Block 2
- ❌ Block 3

## CONTEXT

### Current State
[Description of where the project is now]

### What We've Tried
[Previous attempts and why they didn't work, if applicable]

### Files Involved
[Key files this task will interact with]

### Dependencies
[What this task depends on, if anything]

## VERIFICATION

After completing your work:
1. [Verification step 1]
2. [Verification step 2]
3. [Verification step 3]

Report back with:
- What you completed
- Evidence of completion (test output, file diffs, etc.)
- Any blockers or issues encountered
```

## Example: Implementation Task

```markdown
# TASK

Implement user authentication middleware for Express.js following the JWT pattern specified in SPEC.md.

## EXPECTED OUTCOME

You will have successfully completed this task when:
- `src/middleware/auth.ts` exists with JWT verification
- Unit tests in `tests/middleware/auth.test.ts` pass
- Integration tests with protected routes pass
- Code follows existing middleware patterns in codebase

## REQUIRED SKILLS

This task requires:
- TypeScript: Express middleware implementation
- JWT: Token verification and error handling
- Testing: Jest unit and integration tests
- Code patterns: Following existing middleware structure

This is why you were chosen: You're an implementation agent with full tool access and TDD enforcement.

## REQUIRED TOOLS

You will need these tools:
- Read: To examine existing middleware patterns
- Write: To create new middleware and test files
- Edit: To update route handlers with authentication
- Bash: To run tests and verify implementation

**Tools denied:** None (full implementation access)

## MUST DO

These are non-negotiable requirements:
- [ ] Write tests BEFORE implementation (TDD)
- [ ] Follow existing middleware pattern in `src/middleware/logger.ts`
- [ ] Handle all JWT verification errors (expired, invalid, malformed)
- [ ] Add TypeScript types for auth context
- [ ] Run full test suite and confirm no regressions

## MUST NOT DO

Hard blocks - these will cause task failure:
- ❌ Implement code before writing tests
- ❌ Use `any` type or `@ts-ignore`
- ❌ Copy/paste from external sources without understanding
- ❌ Skip error handling for "happy path only"
- ❌ Commit broken code

## CONTEXT

### Current State
- Express server in `src/server.ts`
- Existing middleware: logger, error-handler, cors
- Route definitions in `src/routes/`
- No authentication currently implemented

### What We've Tried
- N/A (first implementation)

### Files Involved
- `src/middleware/auth.ts` (new)
- `tests/middleware/auth.test.ts` (new)
- `src/routes/*.ts` (will be edited to add auth)
- `src/types/express.d.ts` (may need to extend Request type)

### Dependencies
- Express types must be extended for `req.user`
- JWT secret must be in environment config
- Test database must support auth fixtures

## VERIFICATION

After completing your work:
1. Run `npm test` - all tests must pass
2. Run `npm run type-check` - no TypeScript errors
3. Start dev server and hit protected endpoint - should return 401 without token
4. Hit protected endpoint with valid token - should return 200 with user context

Report back with:
- Test output showing all tests passing
- Example request/response demonstrating working auth
- Any issues or decisions made during implementation
```

## Example: Read-Only Review Task

```markdown
# TASK

Review the data pipeline implementation in `src/pipeline/` for performance issues and potential memory leaks.

## EXPECTED OUTCOME

You will have successfully completed this task when:
- All performance bottlenecks are identified
- Memory leak risks are documented
- Recommendations are prioritized (critical/high/medium/low)
- No code has been modified (read-only review)

## REQUIRED SKILLS

This task requires:
- Node.js: Stream processing and memory management
- Performance analysis: Identifying bottlenecks
- Code review: Spotting anti-patterns

This is why you were chosen: You're a read-only review agent focused on analysis without modification.

## REQUIRED TOOLS

You will need these tools:
- Read: To examine pipeline code
- Grep: To find related patterns
- Glob: To discover all pipeline files

**Tools denied:** Write, Edit, Bash, NotebookEdit (read-only mode)

## MUST DO

These are non-negotiable requirements:
- [ ] Review ALL files in `src/pipeline/`
- [ ] Check for common Node.js performance anti-patterns
- [ ] Identify memory leak risks (listeners, unclosed streams, circular refs)
- [ ] Prioritize findings by severity
- [ ] Provide specific file:line references for each issue

## MUST NOT DO

Hard blocks - these will cause task failure:
- ❌ Modify any files (read-only review)
- ❌ Suggest code changes (only identify issues)
- ❌ Run performance benchmarks (analysis only)
- ❌ Skip files because "they look fine"

## CONTEXT

### Current State
- Pipeline processes 10GB+ files
- Recent reports of memory usage spikes
- No profiling data available yet

### What We've Tried
- Manual code review (incomplete)
- No automated analysis yet

### Files Involved
- `src/pipeline/*.ts` (all files)
- Related: `src/streams/`, `src/workers/`

### Dependencies
- None (standalone review)

## VERIFICATION

After completing your work:
1. Confirm you reviewed every .ts file in pipeline/
2. Confirm each issue has file:line reference
3. Confirm issues are prioritized by severity

Report back with:
- Markdown document with findings
- File:line references for each issue
- Severity rankings (critical/high/medium/low)
- No code modifications were made
```

## Usage in Skills

### dev-delegate

```markdown
When delegating to Task agents, use the structured delegation template:

Task(
    subagent_type="general-purpose",
    prompt=f"""
    {structured_delegation_template}

    # TASK
    Implement {feature_name} following TDD

    ## EXPECTED OUTCOME
    ...
    """,
    description="TDD implementation"
)
```

### ds-delegate

```markdown
When delegating data analysis tasks:

Task(
    subagent_type="general-purpose",
    prompt=f"""
    {structured_delegation_template}

    # TASK
    Profile dataset and identify data quality issues

    ## EXPECTED OUTCOME
    ...
    """,
    description="Data profiling"
)
```

## Benefits

1. **Clear contracts** - No ambiguity about expectations
2. **Verification built-in** - Success criteria upfront
3. **Tool restrictions explicit** - Prevents scope creep
4. **Context preserved** - Agent understands bigger picture
5. **Failure recovery** - MUST DO/MUST NOT DO catches issues early

## Anti-Patterns

**DON'T:**
- Skip sections ("they can figure it out")
- Use vague success criteria ("make it work")
- Omit tool restrictions ("give them everything")
- Forget context ("they should know")

**DO:**
- Fill every section completely
- Make success criteria measurable
- Restrict tools by default
- Provide rich context
