# SpotOn on Amazon Bedrock AgentCore — troubleshooting guide

Every entry is grounded in something that actually happened while deploying SpotOn,
or in a failure mode the code makes possible. Format: **symptom → likely cause →
how to verify → fix**.

## Reference values

| | |
|---|---|
| Account / region | `209479307795` / `us-east-1` |
| Runtime ARN | `arn:aws:bedrock-agentcore:us-east-1:209479307795:runtime/spoton_spoton-ofYrfc9nZC` |
| Runtime id | `spoton_spoton-ofYrfc9nZC` |
| Log group | `/aws/bedrock-agentcore/runtimes/spoton_spoton-ofYrfc9nZC-DEFAULT` |
| Model | `global.anthropic.claude-sonnet-4-6` |
| Tables | `spoton-{residents,vehicles,spaces,permits,waitlist,vehicle-reports}` |

## The two commands you will use most

```bash
# newest deploy log
ls -t agentcore/.cli/logs/deploy/*.log | head -1 | xargs tail -40

# runtime logs (where tracebacks and logger.info land)
AWS_PROFILE=spoton aws logs tail \
  /aws/bedrock-agentcore/runtimes/spoton_spoton-ofYrfc9nZC-DEFAULT \
  --region us-east-1 --since 10m --format short
```

**Logs only appear after an invocation.** A container boots on invoke; if you deploy and
immediately tail, you will see the *previous* failure and misread it as current. Check
timestamps against the deploy time.

---

## 1. "Runtime initialization time exceeded... 30s"

**This is almost never about speed.** A module-level exception looks identical to slowness
from outside: the container never answers `/ping`, and AgentCore reports a generic timeout.

- **Verify:** tail the runtime log. A Python traceback will be there.
- **Fix:** whatever the traceback says. The timeout message itself carries no information.
- **Measured baseline:** SpotOn's full import chain is ~1.2s locally, so genuine slowness
  is implausible. Don't chase performance.

## 2. `ProfileNotFound: The config profile (spoton) could not be found`

The failure that cost the most time.

- **Cause:** `AWS_PROFILE` reaching the container. `load_dotenv()` runs at import in
  `tools/parking_tools.py:18`, `repositories/dynamodb_repository.py:40` and
  `services/email_service.py:11`, each resolving `/var/task/.env` — and **`.env` ships into
  the container**, even though `agentcore package`'s zip does not contain it.
- **Verify:** `AWS_PROFILE` must not be assigned in `spoton_backend_app/.env`
  (`grep -nE "^\s*AWS_PROFILE\s*=" spoton_backend_app/.env` → no match).
- **Fix:** remove it from `.env`; pass it per-command locally (`spoton.sh` already does).
- **Note:** botocore reads **both** `AWS_DEFAULT_PROFILE` and `AWS_PROFILE`
  (`botocore/configprovider.py:73`), in that precedence order. Popping only one is not enough —
  and popping either is useless anyway, because `load_dotenv` runs *after* the entrypoint's
  module body.

## 3. Bedrock `AccessDeniedException`

Two very different causes with similar messages.

**(a) Model not entitled to the account.** Message ends `...is not available for this account
... contact AWS Sales`.
- **Verify:** `aws bedrock-runtime converse --model-id <id> --messages '[{"role":"user","content":[{"text":"hi"}]}]' --inference-config '{"maxTokens":1}' --region us-east-1`
- **Note:** `list-inference-profiles` showing a model is **not** entitlement. Opus 5, Sonnet 5
  and Opus 4.8 are listed but denied on this account; Opus 4.6, Sonnet 4.6 and Haiku 4.5 work.
- **Fix:** use an entitled model via `SPOTON_MODEL_ID`, and update the Bedrock ARNs in
  `spoton-runtime-policy.json` to match.

**(b) Execution role missing the model.** Message names the inference profile.
- **Cause:** a `global.` profile routes to foundation models; permitting only the profile ARN
  is insufficient.
- **Verify:** `aws bedrock get-inference-profile --inference-profile-identifier <id>` lists the
  member model ARNs. All of them must appear in the policy.
- **Fix:** the policy needs the profile ARN **plus** `arn:aws:bedrock:::foundation-model/<model>`
  (no region) **and** `arn:aws:bedrock:us-east-1::foundation-model/<model>`.

## 4. DynamoDB `AccessDenied`

- **Verify:** the failing action name in the log against `spoton-runtime-policy.json`.
- **Expected action list is exactly five:** `GetItem`, `PutItem`, `UpdateItem`, `Query`, `Scan`.
  No `DeleteItem` (the code never deletes). **No `TransactWriteItems` — that is not a real IAM
  action**; transactions authorize through `PutItem`/`UpdateItem`.
- **If a GSI is ever added:** base-table ARNs are not enough; add `.../table/<name>/index/*`.

## 5. SES `AccessDenied`, or `resident_email_sent: false`

- **Symptom:** the permit is created and the reply claims an email was sent, but the flag is
  `false`. Never a crash — `email_service` handles failures gracefully, which makes this silent.
- **Verify:** the permit payload's `resident_email_sent` / `admin_email_sent`, then the runtime log.
- **Causes:** `ses:SendEmail` scoped to the wrong identity (it authorizes on the **sender**,
  `SPOTON_SES_FROM_EMAIL`, not the recipient); `SPOTON_SES_FROM_EMAIL` empty (defaults to `""`);
  or **`SPOTON_EMAIL_MODE=mock`**, which reports success without sending.
- **Fix:** check `SPOTON_EMAIL_MODE` in `agentcore.json` first — mock is the likeliest answer.

## 6. Agent says `mock_data/` is missing

- **Cause:** `SPOTON_DATA_BACKEND` not reaching the container. It defaults to `"csv"`
  (`repositories/repository_factory.py:27`), so the runtime builds a `CsvRepository` and looks
  for files that are not in the bundle.
- **Verify:** `aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id <id> --query environmentVariables`
- **Fix:** ensure `SPOTON_DATA_BACKEND=dynamodb` is in `agentcore.json`, then redeploy.

## 7. `ModuleNotFoundError` in the runtime

- **Cause:** a dependency not declared in `spoton_backend_app/pyproject.toml`. CodeZip resolves
  from that file, not from your `.venv`.
- **Verify:** `unzip -l agentcore/spoton.zip | grep <module>` — but see §12, the deployed bundle
  may differ.
- **Fix:** `uv add <package>`, redeploy.

## 8. `ParamValidationError` on `runtimeSessionId`

- **Cause:** a session id shorter than 33 characters. botocore's `SessionType` shape is
  `min: 33, max: 256` and is enforced **client-side**, before any AWS call.
- **Where it bites:** `ChatRequest.session_id` defaults to `"default"` (7 chars) and
  `AdminChatRequest.session_id` to `"admin-default"` (13). React always sends a 36-char
  `crypto.randomUUID()`, so this only appears in hand-testing.
- **Fix:** already handled — `services/agentcore_client.py::_runtime_session_id()` pads short ids
  with a sha256 digest. The padding is **deterministic on purpose**: a changing
  `runtimeSessionId` would break microVM stickiness and lose conversation memory.

## 9. Resident asked for their unit number again mid-conversation

- **Cause:** not a bug. MicroVMs terminate after ~15 minutes idle (8 hours max), wiping
  `_agents` and `_SESSIONS` in the runtime process. The next invoke gets a cold VM.
- **Consequence to watch:** that turn returns `resident: null`, and `main.py:89` caches the
  `None` over a previously good value — which then breaks `/api/waitlist/offers`.
- **Mitigations:** guard the cache (`if result.get("resident"):`) or raise
  `idleRuntimeSessionTimeout`. Before a demo, keep the session warm.

## 10. `/api/waitlist/offers` returns `{"offers": []}` forever

The nastiest failure mode in the system, because **broken and working look identical** — both
return an empty list with HTTP 200.

- **Cause:** `get_waitlist_offers()` (`tools/parking_tools.py:726`) is a **plain function**, not a
  Strands tool. It reads `_SESSIONS` in the **FastAPI** process, which AgentCore never populates.
- **Fix (in place):** `main.py` calls `set_current_session(...)` then
  `_set_current_resident(result.get("resident"))` after each chat turn.
- **Verify — the only reliable test is the full scenario:** identify a resident, fill the lot,
  join the waitlist, then **release a space**. Check the entry flips `waiting` → `offered`:
  ```bash
  AWS_PROFILE=spoton aws dynamodb scan --table-name spoton-waitlist --region us-east-1 \
    --query 'Items[?status.S==`waiting` || status.S==`offered`].[waitlist_id.S,resident_id.S,status.S]' --output table
  ```

## 11. Waitlist offer never appears after releasing a space

- **Cause, usually sequencing.** `release_permit` matches the waitlist **only at the instant a
  space is freed** — it is not a background job. Releasing before a `waiting` entry exists
  produces nothing, and looks exactly like §10.
- **Also:** `_match_waitlist_for_released_space()` skips entries whose `end_time` has passed, so
  stale entries from earlier testing are ignored (correctly). It then picks the **oldest**
  remaining — so another resident's older entry can legitimately win the space.
- **Verify:** compare `created_at` and `end_time` on all `waiting` entries against `date -u`.

## 12. Code changes appear to have no effect

- **Cause:** editing a file changes nothing until `agentcore deploy`. The container runs the
  bundle built at deploy time.
- **Verify:** compare the traceback's **line numbers** against your current file, and check
  `agentCoreVersion` / `lastUpdatedAt`:
  ```bash
  AWS_PROFILE=spoton aws bedrock-agentcore-control get-agent-runtime \
    --agent-runtime-id spoton_spoton-ofYrfc9nZC --region us-east-1 \
    --query '[agentRuntimeVersion,lastUpdatedAt,status]' --output text
  ```
- **Also:** `agentcore/spoton.zip` is produced by `agentcore package` and is **not** what
  `agentcore deploy` ships. Its timestamp goes stale while deploys continue. Never treat it as
  evidence about the deployed bundle.

## 13. Deploy fails at "Check stack status" / "Bootstrap AWS environment"

Deploy-identity permissions, not runtime problems. Everything hit during setup:

| Denied action | Add to |
|---|---|
| `cloudformation:*` (Describe/Create/Update/ChangeSet…) | `SpotOnCDKDeploy`, scoped to `stack/AgentCore-*/*` and `stack/CDKToolkit/*` |
| `iam:UpdateAssumeRolePolicy` and siblings on `cdk-*` | same, scoped to `role/cdk-*` |
| `ecr:PutImageTagMutability` and similar | `ecr:*` on `repository/cdk-*` |
| `kms:CreateKey` | `Resource: "*"` — a key that doesn't exist yet has no ARN to scope to |
| `ssm:PutParameter` | `parameter/cdk-bootstrap/*` |

`AmazonBedrockFullAccess` does **not** cover AgentCore — `bedrock-agentcore` is a separate IAM
service prefix, and its `PassRoleToBedrock` statement is conditioned on
`iam:PassedToService: bedrock.amazonaws.com` while AgentCore passes to
`bedrock-agentcore.amazonaws.com`. Attach `BedrockAgentCoreFullAccess` too.

**Inline policies cap at 2048 non-whitespace characters across all inline policies on an
identity.** Use customer-managed policies (6144 each, and reusable for the future App Runner role).

## 14. `CDKToolkit` stack stuck

- **`UPDATE_ROLLBACK_FAILED`:** `aws cloudformation continue-update-rollback --stack-name CDKToolkit`.
  **Fix the underlying resource first** — rollback touches the same resources that failed, so it
  will fail again otherwise. `--resources-to-skip` exists but leaves the stack inconsistent.
- **A resource reporting `NotFound` (not `AccessDenied`)** means stack drift — CloudFormation
  manages something that was deleted out of band. Recreate it with the exact name from
  `describe-stack-resources`. **Do not delete CDKToolkit**; it may predate your work and other
  stacks may depend on it.
- **Reading an `AccessDenied` vs a `NotFound`:** in a long permission cascade, a non-`AccessDenied`
  error means **stop adding permissions and re-read**. `HandlerErrorCode` distinguishes
  "you can't" from "it isn't there".

## 15. Region or ARN mismatch

- **Symptom:** `ResourceNotFoundException` from `invoke_agent_runtime`, or the client hitting the
  wrong account.
- **Verify:** `AGENTCORE_RUNTIME_ARN` in `.env`, `AWS_REGION` (`us-east-1` everywhere),
  `aws sts get-caller-identity`, and `aws bedrock-agentcore-control list-agent-runtimes`.
- **Note:** the runtime name is **`spoton_spoton`** — the CLI concatenates project name and
  runtime name, both `spoton` in `agentcore.json`. The ARN is not what you'd guess from config.

## 16. Agent refuses to re-check availability within a session

- **Symptom:** the agent said "no spaces available", a space was then freed, and it still refuses —
  *"It looks like you just made that same request."*
- **Cause:** conversation memory. The system prompt has a "verify before refusing" rule for
  **permits** (`get_permit_status`, `spoton_agent.py:42-48`) but no equivalent for **availability**.
- **Not migration-related** — identical in-process.
- **Workaround:** a new `session_id` starts a fresh conversation. **Demo risk:** don't rely on
  freeing a space mid-conversation and having the agent notice.

## 17. Before any demo

```bash
./scripts/seed_mock_data.sh
cd spoton_backend_app && AWS_PROFILE=spoton uv run python seed_dynamodb.py
```

Resets all ten spaces to `available` and the permit table to baseline. It **overwrites by id and
never deletes**, so orphaned permits and reports from testing remain — harmless, since
`check_parking_availability` reads only the spaces table's `status`. Without this you will hit
"no availability" on stage, and multiple `upcoming` permits can claim the same space, which makes
`release_permit` appear to do nothing (it frees a space only if the space still points at that
permit).

Also confirm `SPOTON_EMAIL_MODE` is `live` if the demo needs real confirmation emails.
