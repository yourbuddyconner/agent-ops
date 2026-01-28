"""Base sandbox image definition for Agent-Ops.

Includes system tools, Node.js, Bun, and OpenCode CLI.
Phase 1: no VNC/code-server/TTYD (those come in Phase 2).
"""

import modal

from config import BASE_IMAGE_TAG, NODE_VERSION


def get_base_image() -> modal.Image:
    """Build the base sandbox image with common development tools."""
    return (
        modal.Image.from_registry(BASE_IMAGE_TAG)
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
            'echo \'export BUN_INSTALL="$HOME/.bun"\' >> /root/.bashrc',
            'echo \'export PATH="$BUN_INSTALL/bin:$PATH"\' >> /root/.bashrc',
        )
        # Install OpenCode CLI
        .run_commands(
            "npm install -g @opencode-ai/cli",
        )
        .env(
            {
                "BUN_INSTALL": "/root/.bun",
                "PATH": "/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            }
        )
    )
