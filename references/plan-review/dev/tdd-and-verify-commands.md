# Dev RED-first testing and verification

`## Testing Strategy and Real-Test Contract` must identify the test framework, exact runnable
commands, the user workflow, production protocol/transport, visible result, first test expected
to fail, and the intended RED outcome. Tests must exercise the production-relevant path rather
than inspect source, logs, or a convenient alternate transport.

Each behavioral `TASK-NN` must require observing RED for its intended missing behavior before
implementation, then name a concrete verify command that proves GREEN. Require a full-suite or
E2E command where the scope makes it applicable. Placeholder commands, tests unable to fail for
the change, manual-only validation, and fake-path tests are blocking.
