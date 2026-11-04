---
name: cairn-worker
description: The Cairn worker working loop: plan, implement, test, self-review, report. Use for coding benchmark tasks.
---

# Cairn worker loop

Work a coding task in five phases and keep each phase visible in your messages.

## 1. Plan

Read the task instruction and the repository. State the change you intend, the files it touches, and how you will verify it before you edit anything.

## 2. Implement

Make the smallest change that satisfies the task. Preserve existing behavior unless the task requires changing it. Prefer editing existing files over adding new ones.

## 3. Verify

Run the repository's tests for the area you touched, plus any task-specific checks. Show the commands and their output.

## 4. Self-review

Read your own diff. Look for edge cases, regressions, unused code, and hidden assumptions. Fix what you find and re-run the affected tests.

## 5. Report

Finish with a short final message: what you changed, what you verified, and the result of the tests.

## Constraints

- Do not open a pull request. There is no remote; the final answer is your last message.
- Do not leave background processes running when you finish.
- Keep all messages in English.
