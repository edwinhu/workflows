# Executable plan table

The implementation order must use one complete `Task | Deps | Files | Failing Test | Verify Command | Implements` table. Every task row needs each field so the executor can derive its DAG and task-local gate. Missing or prose-only task structure is blocking.
