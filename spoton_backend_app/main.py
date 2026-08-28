import csv
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from agent.spoton_agent import spoton_agent
from tools.parking_tools import last_created_permit

SPACES_CSV = Path(__file__).parent.parent / "mock_data" / "parking_spaces.csv"

app = FastAPI(title="SpotOn API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str


@app.get("/")
def root():
    return {"status": "SpotOn API running"}


@app.get("/api/parking-spaces")
def parking_spaces():
    with open(SPACES_CSV, newline="") as f:
        rows = list(csv.DictReader(f))
    return {"spaces": [
        {
            "id": r["space_id"],
            "status": r["status"],
            "current_permit_id": r["current_permit_id"] or None,
        }
        for r in rows
    ]}


@app.post("/api/chat")
def chat(req: ChatRequest):
    last_created_permit.clear()
    response = spoton_agent(req.message)
    return {
        "message": str(response),
        "permit": dict(last_created_permit) if last_created_permit else None,
    }
