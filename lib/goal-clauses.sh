# The continuation invariant, shared by every regime that composes an objective.
#
# compose-goal.sh (craft) and hound-arm.sh (the hold) both state a continuation clause, and their
# first sentences legitimately differ -- craft reacts to a FAIL by re-dispatching, the hold reacts
# to a failing check by re-running. Everything AFTER that sentence was byte-identical in both, and
# it is the part that was measured to matter: without it a run "stops at its FIRST stopping point
# rather than its ceiling", which compose-goal.sh calls "the whole difference between a session
# that spends its budget and one that reports a verdict and goes quiet with hours left".
#
# One definition, because two copies of one sentence drift and the drift is silent: the clause
# still reads plausibly after it has lost the half that does the work.
GOAL_CONTINUATION_TAIL='When the stated scope closes and budget remains, pick the largest open item you found while working, say in one line why you picked it, and start it. Report at the ceiling, not at the first stopping point.'
