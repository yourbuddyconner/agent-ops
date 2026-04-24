# Local development image for OpenCode agent.
#
# Mirrors the production sandbox (backend/images/base.py) but stripped to
# the minimum needed for `opencode serve` — no VNC, code-server, whisper,
# or Playwright.  Keeps the build fast (~60s) and the image small (~800MB).
#
# Usage:
#   docker compose up -d        # starts opencode on :4096
#   make dev-opencode           # same thing via Makefile

FROM node:22-slim

# System tools that OpenCode and its tools may need at runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl jq ripgrep ca-certificates openssh-client bash procps unzip \
  && rm -rf /var/lib/apt/lists/*

# Bun (used by runner and opencode custom tools)
RUN curl -fsSL https://bun.sh/install | bash
ENV BUN_INSTALL="/root/.bun"
ENV PATH="$BUN_INSTALL/bin:$PATH"

# OpenCode CLI — pinned to same version as production (backend/images/base.py)
ARG OPENCODE_VERSION=1.1.52
RUN npm install -g opencode-ai@${OPENCODE_VERSION}

# Copy OpenCode config and custom tools
COPY docker/opencode /opencode-config
RUN cd /opencode-config && bun install

# Runner + shared packages (for call_tool, workflow engine, etc.)
COPY packages/shared /valet/packages/shared
COPY packages/runner /valet/packages/runner
RUN echo '{"private":true,"workspaces":["packages/*"]}' > /valet/package.json \
  && cd /valet && bun install \
  && ln -s /valet/packages/runner /runner

WORKDIR /workspace

ENV OPENCODE_SERVER_USERNAME=opencode
ENV HOME=/root

EXPOSE 4096

ENTRYPOINT ["opencode"]
CMD ["serve", "--hostname", "0.0.0.0", "--port", "4096"]
