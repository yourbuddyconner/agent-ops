export default async () => {
  return {
    "experimental.session.compacting": async (_input: unknown, output: { context: string[] }) => {
      output.context.push(`
COMPACTION INSTRUCTIONS — follow exactly before writing your summary:

Your summary must contain these sections. Do NOT omit any of them.
Anything not captured here is permanently lost after compaction.

## Active Work
- Task(s) currently in progress (what, status, what's blocking)
- Child session IDs and their last known status
- What the user is waiting for (if anything)

## Key Decisions Made
- Architectural, process, or preference decisions from this session
- Any constraints or bugs discovered

## Artifacts Created
- Branches, PRs, commits, files changed (include identifiers like PR #N, branch name, commit SHA)

## Things to Remember
- Repo URLs learned this session
- User preferences stated this session
- Project facts discovered (stack, conventions, etc.)

## Resume Instructions
When you resume after this compaction, your FIRST action must be:
1. Call mem_patch to write a journal entry summarizing the above:
   mem_patch("journal/YYYY-MM-DD.md", [{ op: "append", content: "\\n\\n## [time] — Resumed after compaction\\n[paste Active Work + Artifacts here]" }])
2. Check on any child sessions that were running (use get_session_status)
3. Then continue whatever was in progress

Do not respond to the user before completing step 1.
`);
    },
  };
};
