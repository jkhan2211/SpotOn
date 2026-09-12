"""boto3 client for invoking SpotOn's deployed AgentCore Runtime.

This is the only module that knows AgentCore exists. FastAPI routes call
invoke_agent() and get back the same dict shape the in-process agents used to
return, so React's contract is unchanged.
"""

import hashlib
import json
import os
from pathlib import Path

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from dotenv import load_dotenv

# Same pattern as repositories/ and email_service.py — config resolves at import,
# from .env locally and from the process environment when deployed.
load_dotenv(Path(__file__).parent.parent / ".env")

RUNTIME_ARN = os.environ.get("AGENTCORE_RUNTIME_ARN", "")
QUALIFIER = os.environ.get("AGENTCORE_QUALIFIER", "DEFAULT")

_client = boto3.client(
    "bedrock-agentcore",
    region_name=os.environ.get("AWS_REGION", "us-east-1"),
)

# botocore's SessionType shape enforces 33..256 characters client-side.
_MIN_SESSION_LEN = 33
_MAX_SESSION_LEN = 256


class AgentCoreError(RuntimeError):
    """Raised when the runtime could not be invoked, or reported an error."""


def _runtime_session_id(session_id: str) -> str:
    """Map a SpotOn session_id onto a valid runtimeSessionId.

    React sends crypto.randomUUID() (36 chars), which passes through untouched.
    But the Pydantic defaults ("default", "admin-default") and any hand-made test
    id are shorter than 33 and would raise ParamValidationError before the request
    is sent. Padding with a sha256 digest keeps the result DETERMINISTIC, so the
    same SpotOn session always maps to the same microVM and conversation memory
    survives across requests.
    """
    if len(session_id) >= _MIN_SESSION_LEN:
        return session_id[:_MAX_SESSION_LEN]
    digest = hashlib.sha256(session_id.encode("utf-8")).hexdigest()
    return f"{session_id}-{digest}"[:_MAX_SESSION_LEN]


def invoke_agent(role: str, prompt: str, session_id: str, timezone: str | None = None) -> dict:
    """Invoke the deployed runtime and return the agent's JSON response.

    Returns the entrypoint's dict: {"message", "permit", "resident"} for role
    "resident", {"message"} for role "admin".
    """
    if not RUNTIME_ARN:
        raise AgentCoreError("AGENTCORE_RUNTIME_ARN is not set")

    payload = {"role": role, "prompt": prompt, "session_id": session_id}
    if timezone:
        payload["timezone"] = timezone

    try:
        response = _client.invoke_agent_runtime(
            agentRuntimeArn=RUNTIME_ARN,
            runtimeSessionId=_runtime_session_id(session_id),
            qualifier=QUALIFIER,
            contentType="application/json",
            accept="application/json",
            payload=json.dumps(payload).encode("utf-8"),
        )
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "Unknown")
        raise AgentCoreError(f"invoke_agent_runtime failed [{code}]: {exc}") from exc
    except BotoCoreError as exc:
        raise AgentCoreError(f"invoke_agent_runtime failed: {exc}") from exc

    # "response" is a streaming blob — it must be read, not indexed.
    raw = response["response"].read()

    try:
        result = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise AgentCoreError(f"runtime returned non-JSON: {raw[:200]!r}") from exc

    # Defensive: some transports hand back JSON that is itself a JSON string.
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except json.JSONDecodeError as exc:
            raise AgentCoreError(f"runtime returned a non-JSON string: {result[:200]!r}") from exc

    if not isinstance(result, dict):
        raise AgentCoreError(f"runtime returned {type(result).__name__}, expected object")

    # The entrypoint reports failures INSIDE a successful response (see
    # agentcore_app.py) — so the HTTP status is not enough to detect them.
    if "error" in result:
        raise AgentCoreError(f"agent error: {result['error']}")

    return result


if __name__ == "__main__":
    import sys

    role = sys.argv[1] if len(sys.argv) > 1 else "resident"
    text = sys.argv[2] if len(sys.argv) > 2 else "Hi, I am in unit 9"
    sid = sys.argv[3] if len(sys.argv) > 3 else "11111111-2222-4333-8444-555555555555"

    print(f"ARN       : {RUNTIME_ARN}")
    print(f"session   : {sid} -> {_runtime_session_id(sid)}")
    print(f"payload   : role={role} prompt={text!r}")
    try:
        out = invoke_agent(role, text, sid, timezone="America/Toronto")
        print("\nresponse:")
        print(json.dumps(out, indent=2))
    except AgentCoreError as exc:
        print(f"\nFAILED: {exc}")
        sys.exit(1)
