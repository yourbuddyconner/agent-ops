"""Agent-Ops Modal backend — web endpoints for session/sandbox management."""

from __future__ import annotations

import modal

from session import CreateSessionRequest, SessionManager

app = modal.App("agent-ops-backend")

session_manager = SessionManager(app)


@app.function()
@modal.fastapi_endpoint(method="POST", label="create-session")
async def create_session(request: dict) -> dict:
    """Create a new session and spawn a sandbox.

    Request body:
        sessionId: str
        userId: str
        workspace: str
        imageType: str (default "base")
        doWsUrl: str
        runnerToken: str
        jwtSecret: str
        idleTimeoutSeconds: int (default 900)
        envVars: dict[str, str] (optional)

    Returns:
        sandboxId: str
        tunnelUrls: dict[str, str]
    """
    req = CreateSessionRequest(
        session_id=request["sessionId"],
        user_id=request["userId"],
        workspace=request["workspace"],
        image_type=request.get("imageType", "base"),
        do_ws_url=request["doWsUrl"],
        runner_token=request["runnerToken"],
        jwt_secret=request["jwtSecret"],
        idle_timeout_seconds=request.get("idleTimeoutSeconds", 900),
        env_vars=request.get("envVars"),
    )

    result = await session_manager.create(req)

    return {
        "sandboxId": result.sandbox_id,
        "tunnelUrls": result.tunnel_urls,
    }


@app.function()
@modal.fastapi_endpoint(method="POST", label="terminate-session")
async def terminate_session(request: dict) -> dict:
    """Terminate a session's sandbox.

    Request body:
        sandboxId: str

    Returns:
        success: bool
    """
    sandbox_id = request["sandboxId"]
    await session_manager.terminate(sandbox_id)
    return {"success": True}


@app.function()
@modal.fastapi_endpoint(method="POST", label="session-status")
async def session_status(request: dict) -> dict:
    """Get status of a session's sandbox.

    Request body:
        sandboxId: str

    Returns:
        sandboxId: str
        status: str
    """
    sandbox_id = request["sandboxId"]
    return await session_manager.status(sandbox_id)
