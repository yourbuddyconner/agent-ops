"""Agent-Ops Modal backend — web endpoints for session/sandbox management."""

from __future__ import annotations

import modal

app = modal.App("agent-ops-backend")

# Image for the web functions — includes our backend Python modules
# Also mount runner package and docker files so sandbox image builds can reference them
fn_image = (
    modal.Image.debian_slim()
    .add_local_python_source("session", "sandboxes", "config", "images")
    .add_local_dir("docker", remote_path="/root/docker")
    .add_local_dir("packages/runner", remote_path="/root/packages/runner")
)

from sandboxes import SandboxAlreadyFinishedError
from session import CreateSessionRequest, SessionManager

session_manager = SessionManager(app)


@app.function(image=fn_image, timeout=900)
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


@app.function(image=fn_image)
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


@app.function(image=fn_image)
@modal.fastapi_endpoint(method="POST", label="hibernate-session")
async def hibernate_session(request: dict) -> dict:
    """Hibernate a session by snapshotting the sandbox filesystem and terminating it.

    Request body:
        sandboxId: str

    Returns:
        snapshotImageId: str
    """
    from fastapi.responses import JSONResponse

    sandbox_id = request["sandboxId"]
    try:
        snapshot_image_id = await session_manager.hibernate(sandbox_id)
    except SandboxAlreadyFinishedError:
        return JSONResponse(
            status_code=409,
            content={"error": "sandbox_already_finished", "message": "Sandbox has already exited (idle timeout). Cannot hibernate."},
        )
    return {"snapshotImageId": snapshot_image_id}


@app.function(image=fn_image, timeout=900)
@modal.fastapi_endpoint(method="POST", label="restore-session")
async def restore_session(request: dict) -> dict:
    """Restore a session from a filesystem snapshot.

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
        snapshotImageId: str

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

    result = await session_manager.restore(req, request["snapshotImageId"])

    return {
        "sandboxId": result.sandbox_id,
        "tunnelUrls": result.tunnel_urls,
    }


@app.function(image=fn_image)
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
