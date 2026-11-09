### Requests

![Request and response](calls.png)

| Clause | Request | Response | Rows before to after | ok |
|---|---|---|---|---|
| Before: main has no combined Tasks read | `GET /api/tasks?teamId={team}` | `404` `{"error":"Not found"}` | n/a | yes |
| One read: open, recent archived, null sections and standalone question | `GET /api/tasks?teamId={team}` | `200` `{"entries":[{"kind":"question","requestId":"evidence-question","threadId":"chief-evidence","projectId":null,"title":"...` | 7 to 7 ({"id":"evidence-abandoned","phase":"building","archivedAt":1794211689251,"phaseAt":1794211) | yes |
| Answer standalone question | `POST /api/teams/{team}/chief/threads/chief-evidence/questions/evidence-question/answer` `{"answers":[{"header":"Scope","text":"Small"}]}` | `200` `{"kind":"ask_user_question","requestId":"evidence-question","status":"answered","questions":[{"header":"Scope","quest...` | n/a | yes |
| Answered question leaves Tasks | `GET /api/tasks?teamId={team}` | `200` `{"entries":[{"id":"evidence-abandoned","teamId":"WGf_kVaf03_rYO2UxBceV","projectId":"ZSSiU_hZKAo4uK-BZz3kq","title":"...` | n/a | yes |
| Existing todo list remains an array of unarchived tasks | `GET /api/todos?teamId={team}` | `200` `[{"id":"evidence-open","teamId":"WGf_kVaf03_rYO2UxBceV","projectId":"ZSSiU_hZKAo4uK-BZz3kq","title":"evidence-open","...` | n/a | yes |
