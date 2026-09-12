# SpotOn → Amazon Bedrock AgentCore: deployment notes

Working log of every problem hit while taking SpotOn from working local code to a
deployed AgentCore Runtime, September 2026. Kept as raw material for a writeup.

Format: symptom → root cause → fix → lesson.

---

Collected 2026-09-11/12 while taking SpotOn from working local code to a deployed AgentCore Runtime. The user asked for these to be kept for a blog post. Framed as symptom -> root cause -> fix -> lesson.

**The through-line worth leading a blog with: the application code was written once, passed six local tests, and never changed again. Every single failure below was environmental — IAM, packaging, tooling, or account state. The migration was not the hard part; the deployment surface was.**

## Documentation gaps

**1. AWS's own documented AgentCore CLI policy omits CloudFormation entirely.**
Symptom: `deploy` fails at "Check stack status" with `not authorized to perform: cloudformation:DescribeStacks`. Cause: the policy at runtime-permissions.html grants IAM, CodeBuild, S3, ECR and Logs — but no CloudFormation, despite `deploy` being CDK-based and CDK working exclusively through CloudFormation. Fix: a second customer-managed policy with ~15 CloudFormation actions scoped to `stack/AgentCore-*/*` and `stack/CDKToolkit/*`. Lesson: a vendor's "here is the policy you need" is a starting point, not a spec.

**2. `dynamodb:TransactWriteItems` is not an IAM action.**
Symptom: the IAM console policy editor rejects it as non-existent. Cause: DynamoDB transactions authorize through the *underlying* operations (PutItem/UpdateItem/DeleteItem/ConditionCheckItem). Notably the AWS Service Authorization Reference page is JS-rendered and returns nothing to a fetcher, so this could not be confirmed from the docs — the console editor was the authority. Lesson: the IAM policy editor is a queryable source of truth when docs won't load.

**3. `AmazonBedrockFullAccess` does not cover AgentCore.**
Symptom: `bedrock-agentcore-control list-agent-runtimes` denied despite `bedrock:*`. Cause: `bedrock-agentcore` is a **separate IAM service prefix** from `bedrock`. Its `PassRoleToBedrock` statement also silently fails for AgentCore because it is conditioned on `iam:PassedToService: bedrock.amazonaws.com` while AgentCore passes to `bedrock-agentcore.amazonaws.com`. Lesson: adjacent service names do not imply shared IAM namespaces, and a Condition can make a matching Resource useless.

## Model access

**4. Listing an inference profile is not entitlement.**
Symptom: `aws bedrock list-inference-profiles` shows `global.anthropic.claude-opus-5` and `claude-sonnet-5`; invoking either returns `AccessDeniedException: ... is not available for this account ... contact AWS Sales`. Cause: listing reflects what exists in the region, not what the account may call. Fix: the only reliable entitlement test is a 1-token `aws bedrock-runtime converse` per model id, in a loop. Verified accessible on this account: Opus 4.6, Sonnet 4.6, Haiku 4.5. Lesson: "contact AWS Sales" phrasing means it is not a self-serve toggle; do not burn time in the console looking for one.

**5. A `global.` inference profile needs permissions on its member foundation models too.**
Cause: the profile routes to foundation models; a policy naming only the profile ARN denies at invoke time while *naming the profile*, which reads as nonsense. `aws bedrock get-inference-profile` reports the exact member ARNs — for Sonnet 4.6 that was `arn:aws:bedrock:::foundation-model/...` (no region) plus the us-east-1 one.

## Tooling and config

**6. Hand-writing `agentcore.json` leaves you missing files `deploy` requires.**
Two separate failures: `aws-targets.json` not found, then `CDK project not found at agentcore/cdk`. Cause: `agentcore create` generates a whole project; writing the config by hand skips the rest. Fix: `agentcore create --project-name <same-name> --no-agent --defaults` in a temp dir generates *only* config + CDK (fast, no venv), then copy `agentcore/cdk/` across. The CDK project is generic — it reads `agentcore.json` at synth time and embeds no project name. Lesson: scaffolders produce more than the file you noticed.

**7. The scaffold's own `.gitignore` does not cover the CLI's build output.**
Symptom: 154 MB untracked (`spoton.zip` 38 MB + `spoton/staging/` 116 MB, 5700 files). Cause: the generated ignore file lists `.cache/*`, but the CLI actually writes `<runtime>.zip` and `<runtime>/staging/`. Fix: add `*.zip` and `*/staging/`. Lesson: verify a generated ignore file against what the tool actually emits; `git add -A` was one keystroke from a 154 MB commit.

## Account state

**8. A pre-existing CDKToolkit stack at an older bootstrap version.**
Symptom: bootstrap fails, stack lands in `UPDATE_ROLLBACK_FAILED`. Cause: the account was bootstrapped previously; the CLI attempted an *upgrade*, which hit an IAM denial, and the rollback hit the same denial. Fix: `aws cloudformation continue-update-rollback` (NOT delete — the stack predated this work and other stacks may depend on it), wait for `UPDATE_ROLLBACK_COMPLETE`, then retry. Lesson: `UPDATE_ROLLBACK_FAILED` is recoverable and delete is the wrong reflex.

**9. CDK bootstrap is an admin operation, and its permissions cascade.**
Hit in sequence: `iam:UpdateAssumeRolePolicy` on `cdk-*` roles, then `ecr:PutImageTagMutability` on the `cdk-*` container assets repo. Each fix surfaced the next. Fix that ended it: widen the *action* to `ecr:*` and `s3:*` while keeping the *resource* tightly scoped to `cdk-*`. Lesson: when enumerating actions turns into whack-a-mole, widen actions and keep resources narrow — the security property you care about is usually resource scope. The genuinely sensitive grants (the execution role's DynamoDB/SES/Bedrock) stayed explicit throughout.

**9b. CDK bootstrap's KMS key: a case where resource-scoping is impossible, not lazy.**
Symptom: after the IAM-role and ECR denials were fixed, bootstrap ran **3m 23s** (vs 37s for the earlier fast failures) and died on `FileAssetsBucketEncryptionKey (AWS::KMS::Key)` -> `Access denied for operation 'CreateKey'`. Cause: CDK bootstrap encrypts the file-assets bucket with a customer-managed KMS key, and the deploy identity had only `kms:DescribeKey` (inherited from `AmazonBedrockFullAccess`). Fix: a `CDKBootstrapKMS` statement with `kms:CreateKey`, `CreateAlias`, `DeleteAlias`, `ListAliases`, `DescribeKey`, `GetKeyPolicy`, `PutKeyPolicy`, `EnableKeyRotation`, `ScheduleKeyDeletion`, `TagResource` — at **`Resource: "*"`**.

**The lesson worth writing up** is the contrast with fix #9. For ECR/S3 the resource ARN was known (`cdk-*`), so the safe move was to **widen actions and keep resources narrow** (`ecr:*` on `repository/cdk-*`). For KMS `CreateKey` there is **no ARN to scope to — the key does not exist yet**, which is an AWS constraint, not sloppiness. So the trade inverts: keep the **action list explicit and minimal** and accept `Resource: "*"`. `kms:ListAliases` is the same. Reaching for `kms:*` on `*` would have been the lazy version of the same fix and is worth calling out as the wrong answer.

Bootstrap creates five kinds of resource — 5x `cdk-*` IAM roles, the container-assets ECR repo, the S3 staging bucket, the KMS encryption key, and the SSM version parameter. Each denial surfaced one at a time, in that order, because CloudFormation stops at the first failure. **Rising duration between attempts (37s -> 3m 23s) was the reliable signal of progress**, not the error text.

**9c. Stack drift: CloudFormation managing an S3 bucket that no longer exists.**
Symptom: after the KMS fix, bootstrap ran **6m 8s** and failed on `StagingBucket (AWS::S3::Bucket)` with `"The specified bucket does not exist" (404, HandlerErrorCode: NotFound)` — **not** an AccessDenied. Cause: the `CDKToolkit` stack still listed `StagingBucket` (expected name `cdk-hnb659fds-assets-<account>-<region>`) as one of its resources, but the real bucket had been **deleted out-of-band** at some earlier point. CloudFormation was trying to update a resource that wasn't there. This means the account's CDK bootstrap was **already broken before this work started** — which retroactively explains why an upgrade was attempted at all.

Fix: recreate the bucket with the exact name CloudFormation expects (`aws s3api create-bucket`) so the stack can reconcile, then re-run deploy — CFN then applies its intended versioning/encryption/public-access config instead of failing. **Do not delete the CDKToolkit stack**: it predated this work, and by that point it had already successfully created the five `cdk-*` IAM roles, the ECR repo and the KMS key. Recreating one bucket is the smaller, reversible move. Verify first with `describe-stack-resources ... LogicalResourceId=='StagingBucket'` for the expected name and `s3api head-bucket` for whether it exists — **404 means missing (recreate); 403 would mean it exists but is inaccessible, which is a different fix entirely.**

**The lesson, and it is the most generalizable one in this whole list:** an error that is *not* `AccessDenied` in the middle of a long permission cascade is a signal to **stop adding permissions and re-read**. Every failure up to this point was fixed by granting something; this one would not have been, and grinding more IAM at it would have wasted real time. `HandlerErrorCode` is the tell — `AccessDenied` vs `NotFound` distinguishes "you can't" from "it isn't there".

**9d. A failed CloudFormation update leaves the stack un-updatable, and the repair order is not obvious.**
Symptom: the very next `agentcore deploy` failed in **1.6s** with `Stack:...CDKToolkit... is in UPDATE_ROLLBACK_FAILED state and can not be updated.` Cause: the StagingBucket failure (#9c) rolled the stack back, and the rollback itself failed on the same missing bucket — so the stack sat in `UPDATE_ROLLBACK_FAILED`, which CloudFormation refuses to update from at all.

**The ordering insight:** you must **repair the underlying resource FIRST, then resume the rollback.** Running `continue-update-rollback` before recreating the bucket would fail again for the same reason, because rollback touches that resource too. Correct sequence: `s3api create-bucket` with the exact name from `describe-stack-resources` -> `continue-update-rollback` -> poll to `UPDATE_ROLLBACK_COMPLETE` -> `agentcore deploy`. Took ~35s to roll back once the bucket existed.

`--resources-to-skip <LogicalId>` exists as a fallback if rollback still refuses, but it leaves the stack knowingly inconsistent — prefer fixing the drift. Also worth noting: a **1.6s failure is itself a diagnostic** — it means the command was rejected before doing any work, so the problem is stack *state*, not permissions or resources.

## Environment friction

**10. The IDE silently left files at 0 bytes — twice** (`agentcore_app.py`, `agentcore.json`). An empty `.py` imports fine, so "it imported OK" was misleading. Fix: `wc -c` before trusting a file, and prefer a terminal heredoc for small config files.
**11. npm `ETIMEDOUT` on `syscall read`** installing the CLI. The `read` syscall means DNS and TCP succeeded and bulk transfer stalled — so the "check your proxy" advice npm prints is aimed at the wrong layer. It succeeded on a plain retry; the MTU hypothesis was never confirmed and was moot.

## The first failure of the deployed runtime

**12. `ProfileNotFound` fired after all — by a route neither the bundle check nor the env config predicted.**
Symptom: first `agentcore invoke` returned `Runtime initialization time exceeded... 30s`. CloudWatch (`/aws/bedrock-agentcore/runtimes/<id>-DEFAULT`) showed the real cause: `botocore.exceptions.ProfileNotFound: The config profile (spoton) could not be found`, raised at import time from `repositories/dynamodb_repository.py:42` where `boto3.resource()` runs at module level.

Two hypotheses, both **wrong**: `.env` was genuinely absent from the zip *and* the staging dir, and `get-agent-runtime --query environmentVariables` listed exactly the 12 configured vars with no `AWS_PROFILE`. The variable was ambient in the developer's shell and got carried into the container by the build, where it is invisible to the runtime's `environmentVariables` config.

Fix attempt 1 — `os.environ.pop("AWS_PROFILE", None)` before the SpotOn imports — **did not work**. Root cause from the installed source: `botocore/configprovider.py:73` reads `'profile': (None, ['AWS_DEFAULT_PROFILE', 'AWS_PROFILE'], None, None)` — **two** variables, with `AWS_DEFAULT_PROFILE` checked FIRST. Fix: pop both, before any module that builds a boto3 client at import time.

**Three lessons:**
- Verifying the *bundle* and the *runtime env config* are clean does **not** prove a variable is absent from the container. Build-time environment is a third, invisible channel.
- `AWS_PROFILE` is not one variable. `AWS_DEFAULT_PROFILE` takes precedence over it.
- **The traceback's line number proved which code was running.** The failing import moved from `agentcore_app.py:17` to `:23` after the redeploy, which ruled out "stale deployment" and pointed the investigation at the fix rather than the pipeline — saving a wasted deploy cycle. Always diff the line numbers across attempts.

**A 30-second init timeout is rarely about speed.** A module-level exception looks identical to slowness from the outside: the container never becomes healthy, and the only signal is a generic timeout. Go straight to CloudWatch; the timeout message itself carries no diagnostic value. (Local import time was measured at 1.18s, which is how the "it's just slow" theory was ruled out early.)

## The trap that DID fire — and why the check that cleared it was invalid

**13. `agentcore package` does not produce the artifact that `agentcore deploy` ships.**
This is the single most costly mistake of the deployment, and it invalidated an earlier "all clear".

In Phase 16 the `.env`/`AWS_PROFILE` risk was declared neutralised because `unzip -l agentcore/spoton.zip` showed no `.env` and no `.venv` — checked twice, including an exhaustive dotfile search that found only `.gitignore` and `.lock`. **That zip was never what got deployed.** `agentcore/spoton.zip` stayed timestamped at the moment `agentcore package` ran and was untouched by five subsequent `agentcore deploy` runs; deploy builds its own bundle with its own inclusion rules, **and those rules include `.env`**.

Proof came only from instrumenting the container itself — four `print(..., flush=True)` lines at the top of the entrypoint, which reported:
```
STARTUP AWS* = {AWS_REGION, AWS_DEFAULT_REGION, AWS_EXECUTION_ENV, AWS_DNS_SUFFIX, AWS_GENAI_CONTENT_EXTRACTION_OPT_OUT}
HAS /var/task/.env = True      <-- the answer
HAS ~/.aws = False
AWS_CONFIG_FILE = None
AFTER POP AWS* = {...unchanged...}
```
`AWS_PROFILE` was **not** in the container environment at startup — it was set *later*, by `load_dotenv(Path(__file__).parent.parent / ".env")` at `repositories/dynamodb_repository.py:40`, two lines before the `boto3.resource()` on line 42 that raised.

**Fix: delete `AWS_PROFILE=spoton` from `spoton_backend_app/.env`** (root cause). Local dev is unaffected because it is already passed per-command — `spoton.sh:35` and every manual command used the `AWS_PROFILE=spoton` prefix.

**Three wrong theories preceded the right one**, each disproved by measurement: (a) `.env` in the zip — the zip was clean but irrelevant; (b) `AWS_PROFILE` injected as a runtime env var — `get-agent-runtime --query environmentVariables` showed exactly the 12 configured vars; (c) popping `AWS_PROFILE` before the imports — ineffective, because `load_dotenv` runs *after* it, inside the import chain. Popping `AWS_DEFAULT_PROFILE` too (botocore reads both, `configprovider.py:73`) was also ineffective for the same reason, though the precedence fact is real and worth knowing.

**Lessons:**
- **Verify the artifact that actually ships, not a same-named artifact produced by a different command.** A stale timestamp on the thing you inspected is the tell.
- When three theories fail, **stop theorising and instrument the running environment.** Four print statements and one deploy cycle produced certainty that hours of reasoning did not.
- Ordering bugs beat placement fixes: a variable set by a *later* import cannot be removed by an *earlier* pop. Fix the source, not the symptom.
- `os.environ.pop` guards that never fire are worse than no guard — they imply protection that does not exist. They were removed once the evidence showed `AWS_PROFILE` never reached the container environment.

## RESOLVED — first successful deployed invocation

2026-09-12 09:25 local. `agentcore invoke --prompt "Hi, I am in unit 9" --session-id <36-char uuid> --json` returned:

```json
{"message": "Hey Silvano! I've got you set up for Unit 9. How can I help you with parking today?",
 "permit": null,
 "resident": {"resident_id": "2", "unit_number": "9", "first_name": "Silvano", ...}}
```

**The single fix that closed it: deleting `AWS_PROFILE=spoton` from `spoton_backend_app/.env`.** `.env` still ships into the container — that was never changed — but it no longer carries anything harmful, so `load_dotenv` is benign and boto3 falls through to the default credential chain and finds the execution role.

Confirmed working in one call: container boot and full import chain, **Bedrock via the execution role** (the agent reasoned), **DynamoDB via the execution role** (`identify_resident` read `spoton-residents`), the three-field response contract across the runtime boundary, and `permit: null` rather than `{}`.

**Note for the boto3 client (Phase 20):** the CLI's `--json` output nests the agent's reply as a **JSON string** inside the `response` field — `"response": "{\n  \"message\": ...}"`. So `invoke_agent_runtime` returns bytes containing JSON that must be `json.loads`-ed, not a pre-parsed dict. The FastAPI client has to decode twice: transport payload, then the agent's own JSON.

Total: 7 deploy attempts to get infrastructure up, then 6 runtime versions to get the process to boot. **The application code was never the problem** — `agentcore_app.py` was written once and the only change it ever received was removing debug scaffolding.

## Appendix: the bundle inspection that looked reassuring

The `.env` / `AWS_PROFILE` trap tracked since Phase 2 — `.env` getting zipped, `load_dotenv` setting `AWS_PROFILE=spoton` in the container, boto3 failing `ProfileNotFound` instead of falling back to the execution role. **`agentcore package` proved the bundle excludes both `.env` and `.venv`.** Worth writing up anyway as the failure that was designed out rather than debugged: it would have failed inside CloudWatch with nothing in the source code to point at the cause.

Also from the bundle inspection: `_cffi_backend.cpython-313-aarch64-linux-gnu.so` proves CodeZip resolves dependencies fresh for **linux/aarch64 + cpython-3.13** rather than copying the local venv — so the ARM64 contract requirement is handled silently, and `runtimeVersion` really does drive the build.

## How these were actually diagnosed (method, for the blog's "how to debug this yourself" section)

The CLI TUI only ever says `<step> failed` — it is useless alone, but it always prints a log path. Everything came from that file. Reusable: `ls -t agentcore/.cli/logs/deploy/*.log | head -1 | xargs tail -40`.

**AWS denial messages are self-documenting and should be read literally.** The format is always four fields: `User: <arn>` (which identity to fix) / `is not authorized to perform: <action>` (the exact Action string — copy verbatim) / `on resource: <arn>` (the exact Resource to scope to — do not reach for `*`) / `because no identity-based policy allows...` (identity-based = adding the action works; an **explicit deny**, SCP, or permission boundary means adding it will NOT help).

**A real gotcha:** grepping for `not authorized|AccessDenied|Error:` printed a match whose line did **not** contain the action name, because CDK wraps long messages across lines. Grep to *locate*, then `sed -n 'N,Mp'` to read the surrounding block. Never trust a single matched line in wrapped output.

In the CloudFormation tree, the emoji marks the failing resource and the `(AWS::Type)` plus logical id say which service and what for. For stack-level failures, `describe-stack-events` filtered on `FAILED` — **read bottom-up**, since the earliest FAILED event is the real cause and later ones are cascade noise.

**A note the user made on 2026-09-12, worth honouring in the writeup:** they described this as "a very different learning curve" — and that is the honest shape of it. The Strands/AgentCore application work was small and went right the first time (80 lines, six passing local tests, never edited again). The deployment surface — IAM, CDK bootstrap, account drift, packaging — was where all the time and all the learning went. Most tutorials invert that ratio.
