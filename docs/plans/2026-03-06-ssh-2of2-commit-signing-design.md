# SSH 2-of-2 Commit Signing Design

Date: 2026-03-06
Status: Draft (Approved)
Owner: Valet Platform

## Problem & Goals

Valet currently produces unsigned commits from sandbox environments. Enterprise
policies often require cryptographically signed commits and hardware-backed key
custody. Sandboxes are ephemeral and cannot safely hold private key material.

Goals:

- Ensure all Valet commits are signed and show GitHub "Verified".
- Use hardware-backed custody with user approval.
- Keep private keys out of sandboxes and Valet infrastructure.
- Automate enrollment and key registration.
- Default to per-push approval and sign merge commits.

Non-goals:

- OpenPGP signing.
- Sigstore/gitsign.
- Bot-account signing.
- Per-commit approval.

## Architecture & Key Lifecycle

### Signing Format

Use Git SSH signing:

- `gpg.format=ssh`
- `commit.gpgsign=true`
- `gpg.program=valet-sign`

SSH is chosen because Turnkey returns raw ECDSA signatures and GitHub natively
verifies SSH signing keys.

### Automated Enrollment

Enrollment is fully automated by Valet:

1. Create a Turnkey sub-organization for the user.
2. Configure 2-of-2 quorum: user passkey + Valet API key.
3. Generate an ECDSA P-256 key inside Turnkey.
4. Export the public key, convert to SSH format.
5. Register the SSH signing key with GitHub for the user.
6. Persist key metadata in Valet DB.

No private key material is ever exported to Valet or sandboxes.

## Signing Flow & UX

### Per-Push Signing (Default)

1. Agent creates unsigned commits.
2. User initiates push.
3. Runner detects unsigned commits and creates a signing request.
4. SessionAgent DO enters `awaiting_approval` and notifies the frontend.
5. Frontend presents a signing modal with repo, branch, and commit list.
6. User approves via WebAuthn passkey.
7. Worker calls Turnkey `signRawPayload` and receives raw ECDSA signature.
8. Worker constructs SSH signature envelope and returns it to the sandbox.
9. Sandbox finalizes signatures and push continues.

### Merge Commits

When signing is enforced, merge commits must be created locally in the sandbox
so they can be signed via Turnkey. GitHub API merges are not used for strict
signing policies because GitHub would sign with its own key.

### Failure Handling

- User rejects or times out: abort push, keep unsigned commits.
- Turnkey failure: abort push, surface error with retry option.
- Session destroyed mid-sign: abort and require retry.

## Data Model, Security, and Rollout

### Tables

`user_signing_profiles`

- id
- user_id
- turnkey_suborg_id
- turnkey_key_id
- github_key_id
- status
- created_at
- revoked_at

`signing_events`

- id
- session_id
- user_id
- repo
- branch
- commit_count
- status
- created_at
- completed_at

### Security Properties

- Private keys never exist in sandboxes or Valet servers.
- Valet cannot sign without user approval.
- User cannot sign without Valet API key.
- Turnkey provides an audit trail for all signing events.

### Org Policy Flags

- signing_enabled
- signing_required
- signing_policy (per_push, per_session)
- signing_approver_policy (session_owner, last_prompter, designated)

### Rollout

1. Internal pilot with a single org.
2. Enable for opt-in enterprises.
3. Add org-level enforcement and merge-commit requirements.

## Success Criteria

- GitHub "Verified" badge for Valet commits.
- Branch protection rule "Require signed commits" passes.
- All signing requires WebAuthn approval.
- Merge commits are signed via Turnkey.
