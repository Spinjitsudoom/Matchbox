# CLAUDE — Coding Guidelines (excerpt)

Purpose: concise behavioral guidelines to reduce common LLM coding mistakes
and keep edits safe, simple, and goal-oriented.

1. Think Before Coding
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them instead of choosing silently.
- Prefer simpler approaches; call out tradeoffs before implementing.

2. Simplicity First
- Write the minimum code that solves the stated problem.
- Avoid speculative features, one-off abstractions, or unnecessary config.
- If code can be much shorter, prefer the simpler rewrite.

3. Surgical Changes
- Touch only what the task requires; match the surrounding style.
- Do not refactor unrelated code or remove pre-existing dead code.
- Remove only the artifacts your change created (unused imports, variables).

4. Goal-Driven Execution
- Define clear, verifiable success criteria for each task.
- For multi-step work, present a short plan and mark progress.

Additional: Merge this file into project agent docs where useful.

Source: Adapted from forrestchang/andrej-karpathy-skills CLAUDE.md.
