"""Session management — orchestrates sandbox lifecycle."""

from __future__ import annotations

from dataclasses import dataclass

import modal

from sandboxes import SandboxConfig, SandboxManager, SandboxResult


@dataclass
class CreateSessionRequest:
    session_id: str
    user_id: str
    workspace: str
    image_type: str
    do_ws_url: str
    runner_token: str
    jwt_secret: str
    idle_timeout_seconds: int = 900
    env_vars: dict[str, str] | None = None


@dataclass
class CreateSessionResponse:
    sandbox_id: str
    tunnel_urls: dict[str, str]


class SessionManager:
    """High-level session lifecycle management."""

    def __init__(self, app: modal.App) -> None:
        self.sandbox_manager = SandboxManager(app)

    async def create(self, req: CreateSessionRequest) -> CreateSessionResponse:
        """Create a new session by spawning a sandbox."""
        config = SandboxConfig(
            session_id=req.session_id,
            user_id=req.user_id,
            workspace=req.workspace,
            do_ws_url=req.do_ws_url,
            runner_token=req.runner_token,
            jwt_secret=req.jwt_secret,
            image_type=req.image_type,
            idle_timeout_seconds=req.idle_timeout_seconds,
            env_vars=req.env_vars,
        )

        result: SandboxResult = await self.sandbox_manager.create_sandbox(config)

        return CreateSessionResponse(
            sandbox_id=result.sandbox_id,
            tunnel_urls=result.tunnel_urls,
        )

    async def terminate(self, sandbox_id: str) -> None:
        """Terminate a session's sandbox."""
        await self.sandbox_manager.terminate_sandbox(sandbox_id)

    async def hibernate(self, sandbox_id: str) -> str:
        """Hibernate a session by snapshotting its sandbox filesystem and terminating it.

        Returns the snapshot image ID.
        """
        return await self.sandbox_manager.snapshot_and_terminate(sandbox_id)

    async def restore(self, req: CreateSessionRequest, snapshot_image_id: str) -> CreateSessionResponse:
        """Restore a session from a filesystem snapshot."""
        config = SandboxConfig(
            session_id=req.session_id,
            user_id=req.user_id,
            workspace=req.workspace,
            do_ws_url=req.do_ws_url,
            runner_token=req.runner_token,
            jwt_secret=req.jwt_secret,
            image_type=req.image_type,
            idle_timeout_seconds=req.idle_timeout_seconds,
            env_vars=req.env_vars,
        )

        result: SandboxResult = await self.sandbox_manager.restore_sandbox(config, snapshot_image_id)

        return CreateSessionResponse(
            sandbox_id=result.sandbox_id,
            tunnel_urls=result.tunnel_urls,
        )

    async def status(self, sandbox_id: str) -> dict:
        """Get session sandbox status."""
        return await self.sandbox_manager.get_sandbox_status(sandbox_id)
