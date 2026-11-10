export const createdTodoMessage = {
  "id": "m2",
  "role": "assistant" as const,
  "content": {
    "kind": "toolcall",
    "call": {
      "id": "call-create-todo",
      "name": "create_todo",
      "arguments": {
        "projectId": "proj-1",
        "title": "Enforce public-content checks",
        "spec": "Block internal addresses in hooks and CI"
      },
      "startedAt": 11,
      "result": [
        {
          "type": "text",
          "text": "{\"id\":\"todo-1\",\"teamId\":\"t1\",\"projectId\":\"proj-1\",\"title\":\"Enforce public-content checks\",\"spec\":\"Block internal addresses in hooks and CI\",\"phase\":\"todo\",\"phaseAt\":10,\"archivedAt\":null,\"snoozedUntil\":null,\"snoozeMode\":null,\"seqNum\":9,\"orderIndex\":16,\"tagIds\":[],\"latestBuildId\":null,\"lastRunAt\":null,\"hasChanges\":false,\"hasPlan\":false,\"buildHistory\":[],\"sourceTodo\":null,\"blockedBy\":null,\"v\":1,\"createdBy\":\"fixture-createdBy\",\"ownerId\":\"fixture-ownerId\",\"sourceBuildId\":\"fixture-sourceBuildId\",\"sourceKind\":\"fixture-sourceKind\",\"sourceRef\":null,\"output\":\"fixture-output\",\"owner\":null,\"quotaWait\":null}"
        }
      ],
      "isError": false,
      "endedAt": 12
    }
  },
  "createdAt": 11
};
