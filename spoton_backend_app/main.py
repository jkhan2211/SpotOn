import csv
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import agent.spoton_agent as agent_module
import agent.admin_agent as admin_agent_module
from tools.parking_tools import (
    last_created_permit,
    release_permit,
    get_waitlist_offers,
    accept_waitlist_offer,
    decline_waitlist_offer,
    set_current_session,
    get_current_resident,
    clear_all_sessions,
)
from tools.vehicle_reports import get_vehicle_reports, mark_expected, notify_security

SPACES_CSV = Path(__file__).parent.parent / "mock_data" / "parking_spaces.csv"
PERMITS_CSV = Path(__file__).parent.parent / "mock_data" / "permits.csv"

app = FastAPI(title="SpotOn API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"
    timezone: str = "UTC"  # browser-reported IANA zone, e.g. "America/Toronto"


class AdminChatRequest(BaseModel):
    message: str
    session_id: str = "admin-default"


@app.get("/")
def root():
    return {"status": "SpotOn API running"}


@app.get("/api/parking-spaces")
def parking_spaces():
    with open(SPACES_CSV, newline="") as f:
        rows = list(csv.DictReader(f))
    with open(PERMITS_CSV, newline="") as f:
        permits_by_id = {p["permit_id"]: p for p in csv.DictReader(f)}

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


@app.post("/api/chat")
def chat(req: ChatRequest):
    last_created_permit.clear()
    set_current_session(req.session_id)
    agent = agent_module.get_agent_for_session(req.session_id, req.timezone)
    response = agent(req.message)
    return {
        "message": str(response),
        "permit": dict(last_created_permit) if last_created_permit else None,
        "resident": get_current_resident(),
    }


@app.post("/api/chat/reset")
def reset_chat():
    agent_module.reset_all_sessions()
    clear_all_sessions()
    return {"success": True, "message": "All sessions and conversation memory have been reset."}


@app.post("/api/permits/{permit_id}/release")
def release(permit_id: str):
    result = release_permit(permit_id)
    if result.get("error") == "not_found":
        raise HTTPException(status_code=404, detail=result["message"])
    return result


@app.get("/api/waitlist/offers")
def waitlist_offers(session_id: str = "default"):
    return get_waitlist_offers(session_id)


@app.post("/api/waitlist/{waitlist_id}/accept")
def waitlist_accept(waitlist_id: str):
    result = accept_waitlist_offer(waitlist_id)
    if result.get("error") == "not_found":
        raise HTTPException(status_code=404, detail=result["message"])
    if "error" in result:
        raise HTTPException(status_code=409, detail=result["error"])
    return result


@app.post("/api/waitlist/{waitlist_id}/decline")
def waitlist_decline(waitlist_id: str):
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
    agent = admin_agent_module.get_admin_agent_for_session(req.session_id)
    response = agent(req.message)
    return {"message": str(response)}


@app.post("/api/admin/chat/reset")
def admin_chat_reset():
    admin_agent_module.reset_all_admin_sessions()
    return {"success": True, "message": "Admin conversation memory has been reset."}


@app.get("/api/admin/vehicle-reports")
def admin_vehicle_reports():
    return get_vehicle_reports()


@app.post("/api/admin/vehicle-reports/{report_id}/expected")
def admin_vehicle_report_expected(report_id: str):
    result = mark_expected(report_id)
    if result.get("error") == "not_found":
        raise HTTPException(status_code=404, detail=result["message"])
    return result


@app.post("/api/admin/vehicle-reports/{report_id}/notify-security")
def admin_vehicle_report_notify_security(report_id: str):
    result = notify_security(report_id)
    if result.get("error") == "not_found":
        raise HTTPException(status_code=404, detail=result["message"])
    return result
