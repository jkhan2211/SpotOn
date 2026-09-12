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

## The near-miss that didn't happen

The `.env` / `AWS_PROFILE` trap tracked since Phase 2 — `.env` getting zipped, `load_dotenv` setting `AWS_PROFILE=spoton` in the container, boto3 failing `ProfileNotFound` instead of falling back to the execution role. **`agentcore package` proved the bundle excludes both `.env` and `.venv`.** Worth writing up anyway as the failure that was designed out rather than debugged: it would have failed inside CloudWatch with nothing in the source code to point at the cause.

Also from the bundle inspection: `_cffi_backend.cpython-313-aarch64-linux-gnu.so` proves CodeZip resolves dependencies fresh for **linux/aarch64 + cpython-3.13** rather than copying the local venv — so the ARM64 contract requirement is handled silently, and `runtimeVersion` really does drive the build.

## How these were actually diagnosed (method, for the blog's "how to debug this yourself" section)

The CLI TUI only ever says `<step> failed` — it is useless alone, but it always prints a log path. Everything came from that file. Reusable: `ls -t agentcore/.cli/logs/deploy/*.log | head -1 | xargs tail -40`.

**AWS denial messages are self-documenting and should be read literally.** The format is always four fields: `User: <arn>` (which identity to fix) / `is not authorized to perform: <action>` (the exact Action string — copy verbatim) / `on resource: <arn>` (the exact Resource to scope to — do not reach for `*`) / `because no identity-based policy allows...` (identity-based = adding the action works; an **explicit deny**, SCP, or permission boundary means adding it will NOT help).

**A real gotcha:** grepping for `not authorized|AccessDenied|Error:` printed a match whose line did **not** contain the action name, because CDK wraps long messages across lines. Grep to *locate*, then `sed -n 'N,Mp'` to read the surrounding block. Never trust a single matched line in wrapped output.

In the CloudFormation tree, the emoji marks the failing resource and the `(AWS::Type)` plus logical id say which service and what for. For stack-level failures, `describe-stack-events` filtered on `FAILED` — **read bottom-up**, since the earliest FAILED event is the real cause and later ones are cascade noise.

**A note the user made on 2026-09-12, worth honouring in the writeup:** they described this as "a very different learning curve" — and that is the honest shape of it. The Strands/AgentCore application work was small and went right the first time (80 lines, six passing local tests, never edited again). The deployment surface — IAM, CDK bootstrap, account drift, packaging — was where all the time and all the learning went. Most tutorials invert that ratio.
