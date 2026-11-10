### Requests

![Request and response](https://raw.githubusercontent.com/xiechimon/cairn/44d8eba0790db0d665e17a4e6b31ddfc670c8cee/docs/verify/3481/vocabulary-after.png)

Synthetic runtime identifiers are redacted from the generated text; screenshots contain only freshly generated fixture data.

| Clause | Request | Response | Rows before to after | ok |
|---|---|---|---|---|
| Vocabulary read retired | `GET /api/projects/<fixture-project-1>/tags` | `404` `{"error":"Not found"}` | 0 to 0 | yes |
| Vocabulary write retired | `POST /api/projects/<fixture-project-1>/tags` `{"name":"obsolete","color":"#112233"}` | `404` `{"error":"Not found"}` | 0 to 0 | yes |
| Project creation without category seeds | `POST /api/projects` `{"name":"Another vocabulary probe"}` | `201` `{"id":"<fixture-project-2>","name":"Another vocabulary probe","group":null,"teamId":"<fixture-team>","splitP...` | 0 to 0 | yes |
