# SpotOn FastAPI → Amazon ECS Express Mode: deployment notes

Working log of every problem hit deploying the SpotOn FastAPI backend, September 2026.
Format: symptom → root cause → fix → lesson.

Live service: `https://sp-5771e51624804f68b17f6cab206ede6f.ecs.us-east-1.on.aws`

---

## 0. The pivot: App Runner is closed to new customers

**Symptom:** every App Runner doc page opens with *"AWS App Runner is no longer open to new
customers."* The console showed **Services (0)** and a **disabled** "Create service" button.
**Cause:** new-customer signup closed **2026-04-30**; this account had never created a service.
**Fix:** Amazon ECS Express Mode, AWS's named replacement — a container image plus IAM roles,
and AWS provisions the Fargate service, ALB, TLS, autoscaling and networking.
**Lesson:** check service *availability for your account* before designing around a service. The
docs banner is easy to skim past; the disabled button is the real signal.

**Bonus blocker, also version-related:** App Runner's managed Python runtimes top out at **3.11**
(`python311`; `python3` is 3.7/3.8 and EOL Dec 2025). SpotOn declares `requires-python = ">=3.13"`.
So even with access, source deployment would have forced a Python downgrade. Express Mode requires
a container image, which keeps the app on 3.13 — the constraint turned out to be a convenience.

## 1. Docker not available in WSL

**Symptom:** `The command 'docker' could not be found in this WSL 2 distro.`
**Cause:** Docker Desktop installed on Windows with WSL integration disabled.
**Fix:** enable it in Docker Desktop → Settings → Resources → WSL Integration.
**Lesson:** the AgentCore images were built by CodeBuild in AWS, so local Docker had never been
needed — an absent dependency nobody had noticed.

## 2. AWS CLI too old for `create-express-gateway-service`

**Symptom:** `argument operation: Found invalid choice 'create-express-gateway-service'`.
**Cause:** the installed CLI was **2.31.36, dated 13 Nov 2025**. ECS Express Mode launched
**21 Nov 2025** — eight days later.
**Fix:** update the CLI. **No sudo required:**
`./aws/install --install-dir ~/.local/aws-cli --bin-dir ~/.local/bin --update`
**Second lesson:** after updating, `aws --version` reported the new version while subcommands still
came from the old binary — bash had cached the path. **`hash -r`** (or a fresh terminal) is required.
The AWS CLI bundles its own botocore, independent of the project venv: boto3 1.43.82 in the venv had
the operation while the CLI did not.

## 3. IAM permission cascade

Each of these was a separate `AccessDenied`, fixed by extending one customer-managed policy
(`SpotOnEcsDeploy`) rather than creating several:
`ecr:CreateRepository` (the AgentCore-era ECR grants were scoped to `bedrock-agentcore-*` and
`cdk-*`, neither matching `spoton-backend`) · `ec2:CreateDefaultSubnet` · `ecs:*` ·
`ec2:DescribeRouteTables` / `DescribeInternetGateways` · `ec2:ReplaceRoute`.

**Scoping principle used throughout:** widen the *action* where enumeration cascades, keep the
*resource* narrow. `ecr:*` on `repository/spoton-*` is safe; `ecs:*` on `*` was accepted only
because it is the **deploy user** (not the runtime) and the account has no other ECS workloads.
The grant that actually matters — the **task role** — stayed tightly scoped to three services.

## 4. `Unable to assume the service linked role`

**Symptom:** first `create-express-gateway-service` failed immediately.
**Cause:** `AWSServiceRoleForECS` is created automatically on first ECS use — and this account had
never used ECS. The failing call *created* it, then couldn't assume it before IAM propagated.
**Fix:** wait ~60s and retry the **identical** command. AWS documents this explicitly.
**Lesson:** a first-use failure that creates the thing it needs will often succeed on retry. Changing
configuration here would have confused cause and effect.

## 5. ⚠️ The big one: a blackholed default route

**Symptom:** `ResourceInitializationError: unable to pull registry auth ... dial tcp
44.213.61.252:443: i/o timeout` — the Fargate task could not reach ECR.
**Cause, in two parts.** The default VPC had **zero subnets** in the entire region (deleted by
someone earlier) — fixed with `aws ec2 create-default-subnet` in two AZs, which an ALB requires. But
the real problem was worse: the main route table's `0.0.0.0/0` route pointed at
`igw-0c1df7f31d7e9e3c2`, **an internet gateway that no longer exists**. AWS labelled the route state
**`blackhole`**. A different, working gateway (`igw-0aa37e7e6f4d1043d`) was attached to the VPC, but
nothing routed to it.
**Fix:** `aws ec2 replace-route --route-table-id rtb-… --destination-cidr-block 0.0.0.0/0
--gateway-id igw-0aa37e…` (`replace-route`, not `create-route` — the entry already existed).
**Lessons:**
- **`i/o timeout` means no route; `AccessDenied` means no permission.** They look similar in a
  deployment log and have completely different fixes.
- `MapPublicIpOnLaunch=true` on a subnet governs **EC2 instances**, not Fargate tasks.
- This was **pre-existing damage**, like the deleted CDK staging bucket in the AgentCore work. An
  account with a half-dismantled default VPC produces failures that look like your own mistakes.

## 6. ⚠️ The subtle one: 503 with a perfectly healthy application

**Symptom:** `HTTP/2 503` from `awselb/2.0`, while **everything looked healthy**: task `RUNNING`,
`runningCount: 1`, service "reached a steady state", and the container logging
`GET /health → 200 OK` every 30 seconds from the ALB's own two ENIs.

**Diagnosis took four layers:**
1. Target group — `172.31.7.62:8000` state **healthy**. Not the app.
2. Listener — default action `fixed-response` (the 503 HTML), not `forward`. Traffic reaches the
   target group only via a rule.
3. Listener **rule** — matched the exact hostname correctly. `TargetGroupArn` was `null` because it
   is a *weighted* forward, so the first query looked empty.
4. `ForwardConfig.TargetGroups` — **the empty target group had Weight 100; the one holding the
   healthy task had Weight 0.** All traffic was being sent nowhere.

**Root cause:** `describe-service-deployments` showed `status: ROLLBACK_FAILED`, reason *"No rollback
candidate was found to run the rollback"*, triggered by *"circuit breaker threshold was exceeded."*
The original deployment failed because of the blackhole route (#5); the **deployment circuit breaker**
tripped and tried to roll back; there was no previous revision to roll back to, so it died leaving
traffic weights pointed at the empty target group. Fixing the network later let a task become healthy,
but **nothing re-advanced the weights** — the 503 was a fossil of an already-fixed bug.

**Fix:** trigger a new deployment via `update-express-gateway-service`. There is no
force-deployment flag, so a real configuration change is needed — `--cpu 512 --memory 1024` served
double duty: it guaranteed a new service revision *and* halved Express Mode's 1024/2048 default.
**Do not hand-edit the ALB weights** — Express Mode owns those resources and would reconcile the
change away.

**Lessons:**
- **"Steady state" is not "serving traffic."** ECS reported healthy at every layer it owns while
  the ALB served nothing. The real success criterion was the listener rule's target-group weights.
- When the app is provably healthy and the edge returns 503, **walk the path outward**: target
  health → listener default action → listener rules → forward weights.
- A **failed first deployment** is a distinct trap: the circuit breaker's rollback has nothing to
  roll back to, and the service is left in a state that later fixes do not clear on their own.

## 7. Small things worth remembering

- `describe-express-gateway-service` puts the URL at
  `service.activeConfigurations[0].ingressPaths[0].endpoint` — the top-level `service.ingressPaths`
  is `null`, and the value is a **bare hostname** with no scheme.
- botocore's docstring claims Express Mode's default CPU is 256 units; the service actually
  provisioned **1024/2048**. The tutorial page was right and the API docstring is stale.
- Express Mode creates **two** target groups (for canary/blue-green) — one is legitimately empty.
- The container takes **more than 3 seconds** to become ready (boto3 + Strands + OpenTelemetry
  imports), so a local `sleep 3` before curling is not enough.
- `docker buildx` pushes an image index plus a small provenance attestation, so ECR shows extra
  untagged rows alongside each tag. Normal.
