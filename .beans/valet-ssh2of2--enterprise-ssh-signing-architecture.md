---
# valet-ssh2of2
title: Enterprise SSH Commit Signing (Turnkey 2-of-2)
status: planned
type: major-feature
priority: critical
tags:
  - security
  - enterprise
  - git
  - ssh
  - turnkey
  - compliance
created_at: 2026-03-06T00:00:00Z
updated_at: 2026-03-06T00:00:00Z
---

## Summary

Implement SSH-based Git commit signing with Turnkey 2-of-2 co-signing.

- Private key generated and stored inside Turnkey secure enclave
- Signing requires both:
  - Valet API key
  - User WebAuthn passkey approval
- GitHub verifies commits via SSH signing key registered on the user account
- No private key material exists in sandboxes

Formal design doc: `docs/plans/2026-03-06-ssh-2of2-commit-signing-design.md`.

## Goals

- All Valet commits are cryptographically signed
- GitHub shows "Verified" for those commits
- Hardware-backed custody and user approval
- Automated enrollment (no manual Turnkey setup)
- Per-push approval by default
- Merge commits are signed

## Non-Goals

- OpenPGP signing
- Sigstore/gitsign
- Bot-account signing
- Per-commit approval

## Architecture Summary

### Key Lifecycle (Automated)

1. Valet creates a Turnkey sub-org for the user
2. Configure 2-of-2 quorum: user passkey + Valet API key
3. Generate ECDSA P-256 key
4. Export public key and convert to SSH format
5. Register SSH signing key with GitHub
6. Persist key metadata in Valet DB

### Signing Flow (Per-Push)

1. Agent creates unsigned commits
2. Push requested -> Runner detects unsigned commits
3. Signing request sent to SessionAgent DO
4. Frontend shows signing modal; user approves via WebAuthn
5. Worker calls Turnkey `signRawPayload`
6. Worker constructs SSH signature envelope
7. Signature returned to sandbox; commit signed
8. Push proceeds

### Merge Commits

When signing is enforced, merges must be performed locally in the sandbox
so the merge commit can be signed via Turnkey.

## Components

- **Sandbox:** `gpg.format=ssh`, `commit.gpgsign=true`, `gpg.program=valet-sign`
- **Worker:** Turnkey integration + signing relay + SSH envelope construction
- **SessionAgent DO:** signing state machine and approval workflow
- **Frontend:** signing modal + WebAuthn ceremony

## Data Model

New tables:

- `user_signing_profiles` (turnkey ids, github key ids, status)
- `signing_events` (audit trail, outcome, timing)

## Security Properties

- Private key never exists in sandbox or Valet infrastructure
- Valet cannot sign without user approval
- User cannot sign without Valet API key
- Turnkey provides audit trail

## Implementation Phases

1. Turnkey integration + enrollment pipeline
2. Signing relay + SSH envelope construction
3. UI modal + DO state machine
4. Org policy flags + merge commit enforcement

## Success Criteria

- GitHub "Verified" badge on signed commits
- Branch protection rule "Require signed commits" passes
- Signing failure blocks push
- WebAuthn approval required for each push
