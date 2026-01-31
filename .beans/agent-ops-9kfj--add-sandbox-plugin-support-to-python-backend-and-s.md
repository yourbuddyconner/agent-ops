---
# agent-ops-9kfj
title: Add sandbox plugin support to Python backend and start.sh
status: todo
type: task
priority: high
tags:
    - sandbox
    - backend
created_at: 2026-01-31T07:50:27Z
updated_at: 2026-01-31T07:51:15Z
parent: agent-ops-xc0m
blocking:
    - agent-ops-bklb
---

Wire resolved-plugins.json into the sandbox build and startup.

## Files to Modify

### backend/app.py
- Mount resolved-plugins.json into fn_image:
  .add_local_file('resolved-plugins.json', remote_path='/root/resolved-plugins.json')

### backend/images/base.py  
- After existing image chain, read /root/resolved-plugins.json
- For each plugin's sandbox config:
  - apt_install any aptPackages
  - npm install -g any npmPackages
  - run_commands for any runCommands
- Handle missing/empty file gracefully

### docker/start.sh
- After existing OpenCode config setup, add plugin processing:
  - For each plugin in resolved-plugins.json:
    - Copy OpenCode tools from plugin package to .opencode/tools/
    - Copy OpenCode skills from plugin package to .opencode/skills/
    - Merge instructions into opencode.json
  - Copy resolved-plugins.json into runner directory

## Acceptance Criteria
- modal deploy succeeds with empty resolved-plugins.json
- Plugin apt/npm packages are installed in sandbox image when declared
- Plugin tools and skills appear in OpenCode config inside sandbox
- No errors when resolved-plugins.json is missing or empty