import os
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Path, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import AfterValidator, BaseModel, StringConstraints

from repositories import get_repository
from tools.parking_tools import (
    release_permit,
    get_waitlist_offers,
    accept_waitlist_offer,
    decline_waitlist_offer,
    set_current_session,
    _set_current_resident,
)
from services.agentcore_client import invoke_agent, AgentCoreError

from tools.vehicle_reports import get_vehicle_reports, mark_expected, notify_security

# All persistence goes through this — CSV today, pluggable later (see
# repositories/). Routes below never read/write a CSV path directly.
_repo = get_repository()

# No public API explorer: /docs, /redoc and /openapi.json would list every endpoint,
# including admin and email-sending ones, with a "Try it out" button.
app = FastAPI(title="SpotOn API", docs_url=None, redoc_url=None, openapi_url=None)


# Browser origins allowed to call this API, as a comma-separated env var. The
# default is the local React dev server, so local development is unchanged. In
# ECS it is supplied as CORS_ALLOWED_ORIGINS — which is how the Amplify domain
# gets added later by editing configuration instead of code.
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173"
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)



# ── Request limits ────────────────────────────────────────────────────────────────
# The API is public, so every value a caller controls is bounded here — before any
# DynamoDB read, AgentCore invocation or email. Real browser traffic is far below these.
MAX_BODY_BYTES = 16 * 1024               # a real chat request is well under 1 KB
MAX_MESSAGE_CHARS = 1000                 # ~250 tokens; typed demo messages are much shorter
SESSION_ID_PATTERN = r"^[A-Za-z0-9-]+$"  # React sends crypto.randomUUID() (36 chars)


@app.middleware("http")
async def limit_request_body(request: Request, call_next):
    length = request.headers.get("content-length")
    too_large = length is not None and (not length.isdigit() or int(length) > MAX_BODY_BYTES)
    chunked = "chunked" in request.headers.get("transfer-encoding", "").lower()
    if too_large or chunked:
        return JSONResponse({"detail": "Request body too large."}, status_code=413)
    return await call_next(request)


def _safe_timezone(tz_name: str | None) -> str:
    """The browser-reported zone is written into the agent's system prompt, so only a
    real IANA zone name gets through; anything else becomes UTC."""
    if not tz_name or len(tz_name) > 64:
        return "UTC"
    try:
        ZoneInfo(tz_name)
    except Exception:
        return "UTC"
    return tz_name


Message = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_MESSAGE_CHARS)]
SessionId = Annotated[str, StringConstraints(min_length=32, max_length=64, pattern=SESSION_ID_PATTERN)]
Timezone = Annotated[str, AfterValidator(_safe_timezone)]

# Ids are generated server-side (see tools/); anything in another shape cannot exist,
# so it is rejected before it reaches DynamoDB as a key.
PermitId = Annotated[str, Path(pattern=r"^SP-[0-9A-F]{6}$")]
WaitlistId = Annotated[str, Path(pattern=r"^WL-[0-9A-F]{6}$")]
ReportId = Annotated[str, Path(pattern=r"^UV-[0-9A-F]{6}$")]


class ChatRequest(BaseModel):
    message: Message
    session_id: SessionId
    timezone: Timezone = "UTC"  # browser-reported IANA zone, e.g. "America/Toronto"


class AdminChatRequest(BaseModel):
    message: Message
    session_id: SessionId




@app.get("/")
def root():
    return {"status": "SpotOn API running"}



@app.get("/health")
def health():
    """Liveness probe for the ECS Express Mode health check.
    """
    return {"status": "ok"}


@app.get("/api/parking-spaces")
def parking_spaces():
    rows = _repo.get_spaces()
    permits_by_id = {p["permit_id"]: p for p in _repo.get_permits()}

    spaces = []
    for r in rows:
        permit = permits_by_id.get(r["current_permit_id"]) if r["current_permit_id"] else None
        spaces.append({
            "id": r["space_id"],
            "status": r["status"],
            "current_permit_id": r["current_permit_id"] or None,
            # Full permit details travel with the space itself, so the frontend never
            # has to rely on having personally created the permit in this browser
            # session to know who/what currently occupies it (e.g. a waitlist accept,
            # or any booking made before the page loaded).
            "permit": {
                "permit_id": permit["permit_id"],
                "visitor_name": permit["visitor_name"],
                "visitor_plate": permit["visitor_plate"],
                "start_time": permit["start_time"],
                "end_time": permit["end_time"],
                "permit_type": permit["permit_type"],
            } if permit else None,
        })
    return {"spaces": spaces}

# The browser only displays first_name and unit_number. The full resident record
# (resident_id, last name, email) stays server-side for waitlist offers and email,
# and must never be returned to an anonymous caller.
_PUBLIC_RESIDENT_FIELDS = ("first_name", "unit_number")


def _public_chat_response(result: dict) -> dict:
    resident = result.get("resident")
    permit = result.get("permit")
    return {
        "message": result.get("message"),
        "resident": {k: resident[k] for k in _PUBLIC_RESIDENT_FIELDS if k in resident} if resident else None,
        "permit": {k: v for k, v in permit.items() if k != "resident_email"} if permit else None,
    }



@app.post("/api/chat")
def chat(req: ChatRequest):
    try:
        result = invoke_agent("resident", req.message, req.session_id, req.timezone)
    except AgentCoreError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    # Mirror the resolved resident back into FastAPI's own session store.
    # GET /api/waitlist/offers calls get_waitlist_offers(), a PLAIN function that
    # reads _SESSIONS directly — it is not a Strands tool and never runs inside
    # AgentCore. Without this line it would return {"offers": []} forever, with
    # HTTP 200 and no error anywhere. That kills the OfferBanner demo silently.
    set_current_session(req.session_id, req.timezone)
    _set_current_resident(result.get("resident"))

    return _public_chat_response(result)


@app.post("/api/permits/{permit_id}/release")
def release(permit_id: PermitId, timezone: str | None = None):
    result = release_permit(permit_id, tz_name=_safe_timezone(timezone))
    if result.get("error") == "not_found":
        raise HTTPException(status_code=404, detail=result["message"])
    return result


@app.get("/api/waitlist/offers")
def waitlist_offers(session_id: Annotated[str, Query(min_length=32, max_length=64, pattern=SESSION_ID_PATTERN)]):
    return get_waitlist_offers(session_id)


@app.post("/api/waitlist/{waitlist_id}/accept")
def waitlist_accept(waitlist_id: WaitlistId, timezone: str | None = None):
    result = accept_waitlist_offer(waitlist_id, tz_name=_safe_timezone(timezone))
    if result.get("error") == "not_found":
        raise HTTPException(status_code=404, detail=result["message"])
    if "error" in result:
        raise HTTPException(status_code=409, detail=result["error"])
    return result


@app.post("/api/waitlist/{waitlist_id}/decline")
def waitlist_decline(waitlist_id: WaitlistId):
    result = decline_waitlist_offer(waitlist_id)
    if result.get("error") == "not_found":
        raise HTTPException(status_code=404, detail=result["message"])
    return result


# ── Admin / Security — unknown vehicle reports ────────────────────────────────────
# Separate agent from the resident chat (see agent/admin_agent.py) — an Admin isn't a
# resident and has no unit to establish. "Mark as Expected" / "Report to Security" are
# explicit human UI decisions and deliberately do NOT go through Strands at all.

@app.post("/api/admin/chat")
def admin_chat(req: AdminChatRequest):
    try:
        return invoke_agent("admin", req.message, req.session_id)
    except AgentCoreError as exc:
        raise HTTPException(status_code=502, detail=str(exc))



@app.get("/api/admin/vehicle-reports")
def admin_vehicle_reports():
    return get_vehicle_reports()


@app.post("/api/admin/vehicle-reports/{report_id}/expected")
def admin_vehicle_report_expected(report_id: ReportId):
    result = mark_expected(report_id)
    if result.get("error") == "not_found":
        raise HTTPException(status_code=404, detail=result["message"])
    return result


@app.post("/api/admin/vehicle-reports/{report_id}/notify-security")
def admin_vehicle_report_notify_security(report_id: ReportId):
    result = notify_security(report_id)
    if result.get("error") == "not_found":
        raise HTTPException(status_code=404, detail=result["message"])
    return result
