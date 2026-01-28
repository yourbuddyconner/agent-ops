"""Base sandbox image definition for Agent-Ops.

Full dev environment: Node.js, Bun, OpenCode CLI,
code-server, VNC stack (Xvfb + fluxbox + x11vnc + websockify + noVNC),
Chromium, TTYD.
"""

import modal

from config import NODE_VERSION


def get_base_image() -> modal.Image:
    """Build the full sandbox image with all dev environment services."""
    return (
        modal.Image.debian_slim()
        .apt_install(
            "git",
            "curl",
            "wget",
            "jq",
            "ripgrep",
            "build-essential",
            "ca-certificates",
            "gnupg",
            "sudo",
            "unzip",
            "openssh-client",
            "bash",
            "procps",
        )
        # Install Node.js
        .run_commands(
            f"curl -fsSL https://deb.nodesource.com/setup_{NODE_VERSION}.x | bash -",
            "apt-get install -y nodejs",
            "npm install -g npm@latest",
        )
        # Install Bun
        .run_commands(
            "curl -fsSL https://bun.sh/install | bash",
        )
        # Install OpenCode CLI
        .run_commands(
            "npm install -g opencode-ai",
        )
        # code-server (VS Code in browser)
        .run_commands(
            "curl -fsSL https://code-server.dev/install.sh | sh",
        )
        # VNC stack: Xvfb + fluxbox + x11vnc + websockify + noVNC + Chromium
        .apt_install(
            "xvfb",
            "fluxbox",
            "x11vnc",
            "websockify",
            "novnc",
            "chromium",
        )
        # TTYD (web terminal)
        .run_commands(
            'curl -fsSL -o /usr/local/bin/ttyd "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64"',
            "chmod +x /usr/local/bin/ttyd",
        )
        # Runner package (Bun/TS — runs inside sandbox)
        .add_local_dir("packages/runner", "/runner", copy=True)
        .run_commands("cd /runner && /root/.bun/bin/bun install")
        # Copy start.sh
        .add_local_file("docker/start.sh", "/start.sh", copy=True)
        .run_commands("chmod +x /start.sh")
        # Create workspace directory
        .run_commands("mkdir -p /workspace")
        .env(
            {
                "BUN_INSTALL": "/root/.bun",
                "PATH": "/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                "DISPLAY": ":99",
                "HOME": "/root",
            }
        )
    )
