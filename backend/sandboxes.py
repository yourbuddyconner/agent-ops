"""Sandbox lifecycle management for Modal sandboxes."""

from __future__ import annotations

from dataclasses import dataclass

import modal

from config import (
    DEFAULT_IDLE_TIMEOUT_SECONDS,
    GATEWAY_PORT,
    MAX_TIMEOUT_SECONDS,
    OPENCODE_PORT,
    get_secret,
)
from images.base import get_base_image


@dataclass
class SandboxConfig:
    session_id: str
    user_id: str
    workspace: str
    do_ws_url: str
    runner_token: str
    jwt_secret: str
    image_type: str = "base"
    idle_timeout_seconds: int = DEFAULT_IDLE_TIMEOUT_SECONDS
    env_vars: dict[str, str] | None = None


@dataclass
class SandboxResult:
    sandbox_id: str
    tunnel_urls: dict[str, str]


class SandboxManager:
    """Manages Modal sandbox creation, termination, and health checks."""

    def __init__(self, app: modal.App) -> None:
        self.app = app

    async def create_sandbox(self, config: SandboxConfig) -> SandboxResult:
        """Create a new Modal sandbox for a session."""
        image = self._get_image(config.image_type)

        # Build secrets dict — must include all env vars the sandbox needs
        # LLM API keys (ANTHROPIC_API_KEY, etc.) are passed via config.env_vars
        # from the Worker, not from Modal function env.
        secrets_dict: dict[str, str] = {
            "DO_WS_URL": config.do_ws_url,
            "RUNNER_TOKEN": config.runner_token,
            "SESSION_ID": config.session_id,
            "JWT_SECRET": config.jwt_secret,
            "OPENCODE_SERVER_PASSWORD": get_secret("OPENCODE_SERVER_PASSWORD"),
        }

        # Strip empty values so Modal doesn't set blank env vars
        secrets_dict = {k: v for k, v in secrets_dict.items() if v}

        # Merge any additional env vars (caller overrides)
        if config.env_vars:
            secrets_dict.update(config.env_vars)

        sandbox = await modal.Sandbox.create.aio(
            "/bin/bash", "/start.sh",
            app=self.app,
            image=image,
            encrypted_ports=[OPENCODE_PORT, GATEWAY_PORT],
            timeout=MAX_TIMEOUT_SECONDS,
            idle_timeout=config.idle_timeout_seconds,
            secrets=[modal.Secret.from_dict(secrets_dict)],
            volumes={
                "/workspace": modal.Volume.from_name(
                    f"workspace-{config.session_id.replace(':', '-')}",
                    create_if_missing=True,
                ),
            },
        )

        tunnels = await sandbox.tunnels.aio()

        tunnel_urls: dict[str, str] = {}
        if OPENCODE_PORT in tunnels:
            tunnel_urls["opencode"] = tunnels[OPENCODE_PORT].url
        if GATEWAY_PORT in tunnels:
            gateway_url = tunnels[GATEWAY_PORT].url
            tunnel_urls["gateway"] = gateway_url
            tunnel_urls["vscode"] = f"{gateway_url}/vscode"
            tunnel_urls["vnc"] = f"{gateway_url}/vnc"
            tunnel_urls["ttyd"] = f"{gateway_url}/ttyd"

        return SandboxResult(
            sandbox_id=sandbox.object_id,
            tunnel_urls=tunnel_urls,
        )

    async def terminate_sandbox(self, sandbox_id: str) -> None:
        """Terminate a running sandbox."""
        sandbox = await modal.Sandbox.from_id.aio(sandbox_id)
        await sandbox.terminate.aio()

    async def get_sandbox_status(self, sandbox_id: str) -> dict:
        """Check sandbox status."""
        try:
            sandbox = await modal.Sandbox.from_id.aio(sandbox_id)
            return {
                "sandbox_id": sandbox_id,
                "status": "running",
            }
        except Exception:
            return {
                "sandbox_id": sandbox_id,
                "status": "terminated",
            }

    async def snapshot_and_terminate(self, sandbox_id: str) -> str:
        """Snapshot a sandbox's filesystem and terminate it. Returns the snapshot image ID."""
        sandbox = await modal.Sandbox.from_id.aio(sandbox_id)
        image = await sandbox.snapshot_filesystem.aio(timeout=55)
        await sandbox.terminate.aio()
        return image.object_id

    async def restore_sandbox(self, config: SandboxConfig, snapshot_image_id: str) -> SandboxResult:
        """Restore a sandbox from a filesystem snapshot image."""
        image = modal.Image.from_id(snapshot_image_id)

        secrets_dict: dict[str, str] = {
            "DO_WS_URL": config.do_ws_url,
            "RUNNER_TOKEN": config.runner_token,
            "SESSION_ID": config.session_id,
            "JWT_SECRET": config.jwt_secret,
            "OPENCODE_SERVER_PASSWORD": get_secret("OPENCODE_SERVER_PASSWORD"),
        }
        secrets_dict = {k: v for k, v in secrets_dict.items() if v}

        if config.env_vars:
            secrets_dict.update(config.env_vars)

        sandbox = await modal.Sandbox.create.aio(
            "/bin/bash", "/start.sh",
            app=self.app,
            image=image,
            encrypted_ports=[OPENCODE_PORT, GATEWAY_PORT],
            timeout=MAX_TIMEOUT_SECONDS,
            idle_timeout=config.idle_timeout_seconds,
            secrets=[modal.Secret.from_dict(secrets_dict)],
            volumes={
                "/workspace": modal.Volume.from_name(
                    f"workspace-{config.session_id.replace(':', '-')}",
                    create_if_missing=True,
                ),
            },
        )

        tunnels = await sandbox.tunnels.aio()

        tunnel_urls: dict[str, str] = {}
        if OPENCODE_PORT in tunnels:
            tunnel_urls["opencode"] = tunnels[OPENCODE_PORT].url
        if GATEWAY_PORT in tunnels:
            gateway_url = tunnels[GATEWAY_PORT].url
            tunnel_urls["gateway"] = gateway_url
            tunnel_urls["vscode"] = f"{gateway_url}/vscode"
            tunnel_urls["vnc"] = f"{gateway_url}/vnc"
            tunnel_urls["ttyd"] = f"{gateway_url}/ttyd"

        return SandboxResult(
            sandbox_id=sandbox.object_id,
            tunnel_urls=tunnel_urls,
        )

    def _get_image(self, image_type: str) -> modal.Image:
        """Get the appropriate image for the workspace type."""
        # Phase 1: always use base image
        # Future: repo-specific images
        return get_base_image()
