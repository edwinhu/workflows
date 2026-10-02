## What would have to change to make findings gate

Recorded because the answer is not "flip a boolean":

1. **The findings would need independent verification.** Nothing re-derives an external claim today.
   Gating on unverified assertions means gating on another model's false positives. An adversarial
   confirmation pass — Claude verifiers attempting to *refute* each finding, majority to kill — would
   have to sit between the runner and the gate.
2. **`unavailable` and `unparseable` would need a policy.** Advisory makes degradation free. A gate
   must decide whether a provider being down blocks the run, and both answers are bad: blocking makes
   an external service a dependency of your build, not blocking makes the gate skippable by arranging
   for the provider to fail.
3. **The JS gate would have to consult it**, which today it deliberately does not.
4. **It would need its own approval.** Advisory-only is what makes a default-OFF, plan-carried opt-in
   safe to ship without a separate review of the failure modes above.
