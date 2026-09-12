"""AgentCore Runtime entrypoint for SpotOn.

A thin deployment adapter. It contains NO parking logic of its own: it receives the
JSON payload AgentCore parsed out of POST /invocations, selects the right existing
SpotOn agent, invokes it exactly the way main.py's chat routes do today, and returns
the same JSON shape those routes already return to React.

Run locally:  uv run python agentcore_app.py   (serves 0.0.0.0:8080)
"""

import logging

from bedrock_agentcore.runtime import BedrockAgentCoreApp

import agent.spoton_agent as agent_module
import agent.admin_agent as admin_agent_module
from tools.parking_tools import (
    last_created_permit,
    set_current_session,
    get_current_resident,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("spoton.agentcore")

app = BedrockAgentCoreApp()


def _invoke_resident(prompt: str, session_id: str, tz_name: str) -> dict:
    """Mirrors the body of main.py's POST /api/chat, line for line.

    The permit/resident values are read from module globals AFTER the agent runs,
    because that is where the tools write them — so they must be read here, inside
    the AgentCore process, and returned across the boundary. FastAPI can no longer
    read them itself.
    """
    last_created_permit.clear()
    set_current_session(session_id, tz_name)
    agent = agent_module.get_agent_for_session(session_id, tz_name)
    response = agent(prompt)
    return {
        "message": str(response),
        "permit": dict(last_created_permit) if last_created_permit else None,
        "resident": get_current_resident(),
    }


def _invoke_admin(prompt: str, session_id: str) -> dict:
    """Mirrors the body of main.py's POST /api/admin/chat, line for line."""
    agent = admin_agent_module.get_admin_agent_for_session(session_id)
    response = agent(prompt)
    return {"message": str(response)}


@app.entrypoint
def invoke(payload: dict) -> dict:
    """The handler AgentCore calls for every POST /invocations request."""
    role = str(payload.get("role") or "resident").strip().lower()
    prompt = payload.get("prompt")
    session_id = str(payload.get("session_id") or "default")
    tz_name = str(payload.get("timezone") or "UTC")

    if not isinstance(prompt, str) or not prompt.strip():
        return {"error": "payload field 'prompt' is required and must be a non-empty string"}

    logger.info("invoke role=%s session_id=%s tz=%s", role, session_id, tz_name)

    try:
        if role == "resident":
            return _invoke_resident(prompt, session_id, tz_name)
        if role == "admin":
            return _invoke_admin(prompt, session_id)
        return {"error": f"unknown role {role!r} - expected 'resident' or 'admin'"}
    except Exception as exc:
        logger.exception("agent invocation failed role=%s session_id=%s", role, session_id)
        return {"error": f"{type(exc).__name__}: {exc}"}


if __name__ == "__main__":
    app.run()
