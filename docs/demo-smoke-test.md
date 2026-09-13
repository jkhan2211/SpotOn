# SpotOn — production smoke test & demo prep

Deployed stack:

| Layer | Where |
|---|---|
| Frontend | `https://main.d1eyelfeh8f8tj.amplifyapp.com` (Amplify Hosting, `main` branch) |
| Backend | `https://sp-5771e51624804f68b17f6cab206ede6f.ecs.us-east-1.on.aws` (ECS Express / Fargate, image `v3`, pinned to 1 task) |
| Agent | `arn:aws:bedrock-agentcore:us-east-1:<account-id>:runtime/spoton_spoton-ofYrfc9nZC` (AgentCore Runtime) |
| Data | DynamoDB `spoton-*` (6 tables) · SES (live sends) |

---

## PRE-DEMO RESET CHECKLIST

Run this before recording **and** before each full rehearsal. Testing dirties state.

```bash
cd <repo-root>
./scripts/seed_mock_data.sh
cd spoton_backend_app && AWS_PROFILE=spoton uv run python seed_dynamodb.py
```

Then confirm the starting state:

```bash
printf "spaces available : "; AWS_PROFILE=spoton aws dynamodb scan --table-name spoton-spaces \
  --region us-east-1 --query 'length(Items[?status.S==`available`])' --output text
printf "waitlist waiting : "; AWS_PROFILE=spoton aws dynamodb scan --table-name spoton-waitlist \
  --region us-east-1 --query 'length(Items[?status.S==`waiting`])' --output text
printf "reports to review: "; AWS_PROFILE=spoton aws dynamodb scan --table-name spoton-vehicle-reports \
  --region us-east-1 --query 'length(Items[?status.S==`requires_review`])' --output text
```

⚠️ **When editing rows by hand with `aws dynamodb update-item`, always add `--condition-expression "attribute_exists(<key>)"`.** Without it, a mistyped or placeholder id silently **creates a new, incomplete row**. On 2026-09-13 a cleanup command run with the placeholder `WL-XXXXXX` created a waitlist row with only `waitlist_id` and `status`; `GET /api/waitlist/offers` then raised `KeyError: 'resident_id'` (HTTP 500) for every identified resident, so the OfferBanner never appeared even though the offer existed.

**Want: 10 available, 0 waiting, 0 to review.** Expired `waiting` rows are harmless (the match skips them). The seeder never touches vehicle reports, so any report still needing review survives a reseed and keeps showing in the admin review strip: decide it from the dashboard (**Mark as Expected**), which also reopens its space.

⚠️ The seeder **overwrites by id and never deletes**, so permits and vehicle reports created during testing remain as orphans. Harmless — `check_parking_availability` reads only the spaces table's `status` — but it means the permits table grows.

**Warm the agent** ~1 minute before recording: send one throwaway chat message. AgentCore recycles microVMs after ~15 minutes idle, and a cold start costs ~7s versus ~3-4s warm.

**Warm BOTH chats.** Resident and admin use different `session_id`s, so they land on **different microVMs**. Warming only one leaves the other at ~8s. Verified: resident warmed 8.31s -> 4.19s while admin was still cold at 7.80s, then 3.09s once warmed.

### Which resident to use for which flow — this matters

⚠️ **Silvano (unit 9) has NO registered vehicles**, so the *temporary resident parking* flow fails for him — the agent correctly reports he has no vehicle, which on camera looks like a broken feature.

| Flow | Use | Why |
| --- | --- | --- |
| Visitor booking | unit 9 (Silvano) | works fine — no vehicle needed |
| Temp resident parking, simple | **unit 3 (Vick)** | exactly one vehicle (`UAB906`) -> agent uses it automatically |
| Temp resident parking, richer | **unit 14 (Netty)** | two vehicles (`ADM424`, `CJI606`) -> agent asks which one |
| Admin, **matched** plate | `ADM424` | resolves to Netty's registered vehicle, unit 14 |
| Admin, **unmatched** plate | `ZZZ999` | requires review |
| Rejection path | unit 6 (Maximilien) | **inactive** resident — agent relays the reason and refuses |

**Netty (unit 14) supports every flow** and is the safest single resident to build the demo around.

Registered vehicles in seed data: `ADM424`+`CJI606` (Netty, u14) · `DGE717`+`DMX792` (Duff, u35) · `UAB906` (Vick, u3) · `ZYV547` (Carin, u25).

---

## SMOKE TEST — run in sequence

State flows between phases; do not jump around. Space counts shown as `before -> after`.

### Phase 1 — Visitor parking (unit 9, Silvano) · 10 -> 9 -> 10
| # | Do | Expect |
| --- | --- | --- |
| 1 | Load `/resident` | plan renders, 10 available |
| 2 | `Hi, I'm in unit 9` | greets Silvano (~8s, cold microVM) |
| 3 | `My cousin Dev is visiting tonight from 7 to 10 PM, plate DEV123` | permit card, **plan repaints**, notification |
| 4 | Check `+silvano@` and `+security@` | two emails |
| 5 | Click **Release** | space frees, near-instant (deterministic, no agent) |

### Phase 2 — Temporary resident parking (unit 14, Netty) · 10 -> 9
| # | Do | Expect |
| --- | --- | --- |
| 6 | **Switch Unit** | chat resets |
| 7 | `Hi, I'm in unit 14` | greets Netty |
| 8 | `My driveway is being resealed, I need to park my own car from 6 to 9 PM` | **asks which vehicle** (she has two) |
| 9 | `ADM424` | temp resident permit created |

Leave this permit in place — Phase 3 needs a real permit to release.

### Phase 3 — Waitlist (still Netty) · 9 -> 0 -> 1

Occupy the remaining spaces first:
```bash
for S in $(AWS_PROFILE=spoton aws dynamodb scan --table-name spoton-spaces --region us-east-1 \
    --query 'Items[?status.S==`available`].space_id.S' --output text); do
  AWS_PROFILE=spoton aws dynamodb update-item --table-name spoton-spaces --region us-east-1 \
    --key "{\"space_id\":{\"S\":\"$S\"}}" --update-expression "SET #s = :r" \
    --expression-attribute-names '{"#s":"status"}' \
    --expression-attribute-values '{":r":{"S":"reserved"}}' >/dev/null && echo "  $S reserved"
done
```
Refresh the browser afterwards.

| # | Do | Expect |
| --- | --- | --- |
| 10 | `My friend Sam is visiting tomorrow from 7 to 9 PM, plate SAM777` | no availability, offers waitlist, invents nothing |
| 11 | `Yes please` | Sam added to waitlist |
| 12 | Click **Release** on Netty's temp permit | **OfferBanner appears** |
| 13 | Click **Accept** | permit created, plan repaints |

Only the nine blocker spaces are scaffolding. The agent detecting no availability, `join_waitlist`, `release_permit`'s FIFO match, the offer and the accept are all the real code path.

**This works in one tab because Netty owns both the permit and the waitlist entry.** Since backend `v3`, release, accept and decline are only allowed from the browser session that identified as the owner. To show two residents (Netty releases, Silvano gets the offer), use **two tabs**: Netty's tab releases her permit, then **refresh Silvano's tab** to see the OfferBanner (the page does not poll).

### Phase 4 — Admin
| # | Do | Expect |
| --- | --- | --- |
| 14 | Load `/admin` | dashboard, For Review **0** |
| 15 | `Unknown vehicle in V08, plate ZZZ999` | no match (~8s — admin is a **separate microVM**); **V08 flagged ⚠**, For Review 1 |
| 16 | Click **V08** in the review strip → **Report to Security** | "Security notified", security email; **V08 reopens**, For Review 0 |
| 17 | `Unknown vehicle in V10, plate ZZZ998` → V10 in the review strip → **Mark as Expected** | "Decision recorded"; **V10 reopens** |
| 18 | `Check plate ADM424 in space V04` | **matched** to Unit 14; **V04 stays available** (matched plates no longer flag a space) |

Since `v3`, a flagged space returns to available as soon as no report for it needs review, so fake reports can always be cleared from the dashboard without a reseed.

### Phase 5 — Edge cases
| # | Do | Expect |
| --- | --- | --- |
| 19 | `Hi, I'm in unit 99` | asks you to double-check; invents nothing |
| 20 | `Hi, I'm in unit 6` | relays resident is **inactive**, refuses |
| 21 | Release the same permit twice | idempotent, "already released" |
| 22 | **Switch Unit** to a different resident, click a space booked by someone else → **Release Early** | "You can only change your own bookings." (HTTP 403, nothing changes) |

Throughout: no CORS errors in Console, no `localhost` in any request URL.

## EDGE CASES WORTH TESTING (demo-relevant only)

| Case | Expected | Verdict |
|---|---|---|
| Unknown unit number | agent asks you to double-check, does **not** invent a resident | test — it is a good demo beat |
| Inactive resident (unit 6) | relays the reason, refuses to book | test |
| Release an already-released permit | idempotent, reports "already released" | test once |
| Duplicate booking, same visitor | agent calls `get_permit_status` and declines to duplicate | test |
| Agent asked to re-check availability mid-session | ⚠️ **it will not** — answers from conversation memory | **AVOID DURING DEMO** |
| Cold start | ~7s first response | **AVOID** — warm it beforehand |

### The two things to design the demo around

1. **The agent will not re-check availability within a session** once it has said "no spaces available". Your system prompt has a verify-before-refusing rule for *permits* (`get_permit_status`) but none for *availability*. **Do not plan a beat where you free a space mid-conversation and expect the agent to notice.** Use the **Switch Unit** button to start a fresh session instead.
2. **Cold start.** Warm it with a throwaway message a minute before recording.

Neither is a bug; both are architectural consequences worth knowing rather than discovering on camera.

## Live demo safeguards (backend `v3`)

The demo is public during judging, so the backend enforces these limits itself. Every number is an ECS environment variable, so it can be changed with a service update and no image rebuild.

| Limit | Default | Environment variable | What a visitor sees |
|---|---|---|---|
| Agent messages per IP | 30 per 10 min, 150 per day | `SPOTON_AGENT_PER_IP_PER_10_MIN`, `SPOTON_AGENT_PER_IP_PER_DAY` | "You're sending messages quickly…" |
| Messages per conversation | 40 | `SPOTON_AGENT_PER_SESSION` | "This conversation has reached its message limit. Open SpotOn in a new tab…" |
| New conversations per IP | 20 per hour | `SPOTON_NEW_SESSIONS_PER_IP_PER_HOUR` | "Too many new conversations from your network…" |
| Agent calls in total | **300 per UTC day** | `SPOTON_AGENT_GLOBAL_PER_DAY` | "SpotOn's live demo has reached today's usage limit…" |
| Concurrent agent calls | 4 | `SPOTON_AGENT_MAX_CONCURRENT` | "SpotOn is busy right now…" |
| All `/api` requests per IP | 120 per minute | `SPOTON_API_PER_IP_PER_MIN` | "Too many requests…" |

Also enforced: 16 KB request bodies, 1,000-character messages, strict id and session formats, owner-only release/accept/decline, and generic error messages (details go to CloudWatch only). A monthly AWS Budget alert and 30-day log retention are set.

Counters live in memory and reset when the task restarts or redeploys. Judges on the same network share one IP's limits; raise the per-IP values if that becomes a problem.

### Emergency brakes

The official rules require the project to stay available **without restriction** for judging, so use these only for real abuse, and undo them as soon as it stops.

| Brake | Effect | How |
|---|---|---|
| Turn the agent off | Every chat shows the daily-limit message; site plan, release and admin decisions still work | Set `SPOTON_AGENT_GLOBAL_PER_DAY=0` in `express-primary-container.json`, then run `aws ecs update-express-gateway-service --service-arn arn:aws:ecs:us-east-1:<account-id>:service/default/spoton-api --primary-container file://express-primary-container.json --region us-east-1` |
| Roll back the backend | Returns to the previous image | Point `image` back at the previous tag (for example `v2`) and run the same command |

Only run the update command once per change, and wait for it to finish (about 5-10 minutes) before running another.

## Quick-action buttons — every remaining chip is backed by the real system

Both dashboards originally shipped chips and keyword intercepts that answered from hardcoded mock data without reaching the agent. All of them have been removed.

**Resident** (removed in 6f50da9): "Extend a visit" and "Demo: no-show reminder" were frontend theatre (hardcoded strings + `setTimeout`, no fetch; there is no extend tool in the agent). The keyword intercepts in `sendMessage` were also deleted. Remaining chips:

| Button | What it does |
| --- | --- |
| 🚗 Book visitor parking | sends `"My brother Alex is coming from 2-5 PM."` to the agent — a canned prompt, but a real booking |
| 🔓 Release a space | calls `releasePermit()` -> ECS -> DynamoDB |

**Admin** (removed 2026-09-13, before the screenshot run):

- **Chips removed:** "Show current capacity", "Show waitlist", "Recent agent actions" and "Review parking policy" answered from `INITIAL_WAITLIST` / `INITIAL_ACTIVITY` / `POLICIES` in `adminData.js`.
- **Keyword intercepts removed:** `sendMessage` hijacked any message containing `full`, `capacity`, `available`, `how many`, `waitlist`, `waiting`, `recent`, `activity`, `done`, `actions`, `log`, `policy`, `no-show`, `noshow`, `grace` or `rule`, and replied with mock data instead of calling `/api/admin/chat`. A natural phrasing like "log this plate" never reached the agent.
- **"Waitlisted" counter removed:** the stat above the admin site plan always showed **2** (the length of the mock list). The backend has no admin waitlist endpoint, so the counter was removed rather than adding one and redeploying ECS the day before submission.

Only **⚠ Review unknown vehicles** remains; it counts real `requires_review` reports. Every typed admin message now goes to the real agent.
