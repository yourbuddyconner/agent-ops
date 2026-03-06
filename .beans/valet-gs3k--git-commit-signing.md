---
# valet-gs3k
title: Git Commit Signing
status: exploratory
type: design-brief
priority: medium
tags:
    - security
    - git
    - signing
created_at: 2026-03-05T00:00:00Z
updated_at: 2026-03-05T00:00:00Z
---

Some organizations require all commits (including merge commits) to be cryptographically signed, with signing keys custodied on hardware security devices (e.g. YubiKeys). Valet makes commits inside remote sandboxes where the user's hardware key is physically unreachable. We need a model that satisfies signed-commit policies without requiring users to abandon Valet or weaken their security posture.

## Current State

- Sandboxes receive `GIT_USER_NAME`, `GIT_USER_EMAIL`, and `GITHUB_TOKEN` via env vars at boot
- The Runner dynamically swaps `user.name`/`user.email` per-prompt for multi-user attribution
- GitHub push access uses an OAuth token credential helper
- **No commit signing is configured** — all commits are unsigned

## Constraints

1. **Private keys can't exist in sandboxes.** Sandboxes are ephemeral containers on shared infrastructure. Injecting a user's private key material into a sandbox is a non-starter — it violates the hardware-custody guarantee.
2. **Users aren't physically present.** The agent works autonomously. Any scheme requiring a human in the loop for every commit creates unacceptable friction.
3. **GitHub must show "Verified."** The end result needs to pass GitHub's signature verification. This means the public key must be registered on the user's GitHub account (or the org must use Sigstore/Gitsign).
4. **Org policies vary.** Some orgs mandate GPG keys on hardware tokens. Others accept SSH signing keys. Some may accept keyless/OIDC-based signing (Sigstore). The solution should ideally be configurable per-org.

## Approaches

### 1. Platform-Managed Signing Keys (Simplest)

Valet generates and manages a per-user signing key pair. The private key is stored server-side (encrypted at rest in a KMS, never in the sandbox). A custom `gpg.program` in the sandbox calls back to Valet's signing service.

**How it works:**
- On user onboarding, Valet generates an ECDSA or Ed25519 key pair
- The public key is registered on the user's GitHub account as a signing key
- When the sandbox commits, a custom signing program sends the commit hash to the Valet worker, which signs it using the stored private key
- The signature is returned and applied to the commit

**Pros:** Simple. No user interaction per commit. Works with existing Git signing verification.
**Cons:** Valet custodies the key — this is a single point of trust. Does not satisfy hardware-custody requirements. The org must trust Valet's infrastructure as much as they'd trust a YubiKey.

**Satisfies hardware-custody mandate?** No.

### 2. Turnkey Co-Signing (Hardware-Backed, User-Gated)

Use [Turnkey](https://turnkey.com)'s secure enclave infrastructure with a 2-of-2 co-signing model. The signing key lives in Turnkey's hardware-backed enclave — never exposed to Valet or the user. Both the user (via passkey on YubiKey) and Valet (via API key) must approve a signing operation.

**How it works:**
- Per-user Turnkey sub-org with 2/2 root quorum: user (passkey) + Valet (API key)
- Signing key created in the sub-org; public key registered on GitHub
- Sandbox creates an unsigned commit, sends the commit hash to Valet
- Valet initiates a `signRawPayload` request to Turnkey
- The request requires both the user's passkey approval and Valet's API key
- Turnkey returns raw ECDSA signature components (r, s, v)
- Valet wraps the signature in SSH signature format and returns it to the sandbox
- The sandbox applies the signature via a custom `gpg.program`

**Pros:** Key never leaves hardware enclave. Neither Valet nor the user alone can sign. Turnkey provides audit trail. Uses the same YubiKey the user already has (via passkey/WebAuthn).
**Cons:** Requires user interaction for approval (see approval cadence below). Adds Turnkey as a dependency. Requires implementing SSH signature envelope construction from raw ECDSA.

**Satisfies hardware-custody mandate?** Yes — key is in a hardware-backed secure enclave, gated by the user's hardware token.

### 3. Sigstore / Gitsign (Keyless, OIDC-Based)

[Gitsign](https://github.com/sigstore/gitsign) uses Sigstore's keyless signing. No persistent keys at all — the user authenticates via OIDC, Sigstore issues a short-lived certificate, the commit is signed with an ephemeral key, and the certificate is logged in a public transparency log (Rekor).

**How it works:**
- Install `gitsign` in the sandbox image
- Configure `gpg.program = gitsign` and `gpg.format = x509`
- On commit, Gitsign triggers an OIDC flow — the user authenticates (e.g., via GitHub OIDC)
- Sigstore issues a short-lived signing certificate bound to the user's identity
- The commit is signed; the certificate and signature are logged in Rekor
- GitHub verifies the signature against the Sigstore trust root

**Pros:** No key management at all. No hardware dependency. Identity-based rather than key-based. GitHub natively supports Sigstore verification.
**Cons:** Requires OIDC authentication per signing session (though tokens can be cached for a window). The org must accept Sigstore as equivalent to GPG/SSH signing — it's a different trust model. Doesn't satisfy a strict "keys on hardware" mandate. Public transparency log may be undesirable for some orgs.

**Satisfies hardware-custody mandate?** No — there are no persistent keys. However, it provides equivalent assurance through a different mechanism (identity attestation + transparency log).

### 4. Signing Proxy (User Signs Locally)

The sandbox sends commit data to the user's browser, which forwards it to a local signing agent that interacts with the YubiKey directly.

**How it works:**
- Sandbox creates unsigned commit, sends the commit hash to the Valet frontend via WebSocket
- Frontend prompts: "Sign commit abc123?"
- A local helper (browser extension or native app) passes the hash to the user's local GPG agent
- User touches YubiKey, GPG produces the signature
- Signature is sent back through the frontend -> Valet worker -> sandbox
- Sandbox applies the signature

**Pros:** The user's actual YubiKey-custodied GPG key signs the commit. Maximum compliance with existing policies. No new key infrastructure needed.
**Cons:** Requires a local client-side agent (browser extension or native app) — breaks the "everything in the browser" model. Requires the user to be online and present when the agent commits. Latency and reliability concerns with the round-trip. Significantly more complex to implement and support.

**Satisfies hardware-custody mandate?** Yes — the user's own YubiKey signs every commit.

### 5. Bot Account with Org-Managed Key

Valet commits are attributed to a dedicated bot/service account with its own signing key, managed at the org level.

**How it works:**
- Org creates a "valet-bot" GitHub account
- A signing key is generated for the bot (managed by the org in their own HSM/KMS, or by Valet)
- All Valet commits are made as the bot, signed with the bot's key
- Human attribution via `Co-Authored-By` trailer or PR metadata

**Pros:** Clean separation between human and agent commits. Simple to implement. The org controls the bot's key custody however they want.
**Cons:** Commits aren't attributed to the human user. Branch protection rules that require "signed by a member" may not accept bot signatures. Loses the identity link between the human who initiated the work and the commit.

**Satisfies hardware-custody mandate?** Depends on where the org stores the bot's key.

## Approval Cadence (Applies to Approaches 2 and 4)

Any approach that requires user interaction faces an approval frequency question:

| Cadence | Description | Security | UX |
|---------|-------------|----------|----|
| **Per-commit** | User approves every commit individually | Highest — each commit is explicitly authorized | Worst — 12 commits = 12 YubiKey taps |
| **Per-session** | User approves once when starting a Valet session; all commits in that session are auto-signed | Good — scoped to a session with a known repo/branch | Good — one tap per session |
| **Per-push** | Agent commits unsigned; all pending commits are batch-signed before push | Good — user reviews what's being published | Good — one tap per push event |
| **Time-window** | User approves a signing window (e.g., 4 hours) decoupled from session lifecycle | Moderate — window could outlive the task | Good — one tap per window |

**Per-session** and **per-push** are the most natural fits for Valet's interaction model. Per-push has the added benefit of letting the user review the full set of changes before signing.

## Git Signing Format Considerations

Git supports three signing formats. The choice affects what key types work and how GitHub verifies:

| Format | Config | Key Types | GitHub Support |
|--------|--------|-----------|----------------|
| GPG (`openpgp`) | `gpg.format = openpgp` | RSA, Ed25519, ECDSA | Full — verified against GPG keys on profile |
| SSH | `gpg.format = ssh` | Ed25519, ECDSA P-256, RSA | Full — verified against SSH signing keys on profile |
| X.509 / Sigstore | `gpg.format = x509` | ECDSA P-256 (via Sigstore) | Full — verified against Sigstore trust root |

**SSH format is the best fit** for approaches 1 and 2, because:
- Turnkey and most KMS providers produce ECDSA P-256 signatures natively
- SSH signature envelope construction from raw ECDSA is straightforward
- GitHub supports SSH signing key registration via API
- No GPG keyring infrastructure needed

## Implementation Complexity

| Approach | Sandbox Changes | Worker Changes | Frontend Changes | External Dependencies |
|----------|----------------|----------------|------------------|----------------------|
| 1. Platform Keys | Custom `gpg.program` | Signing service, key storage | Key registration UX | KMS for key storage |
| 2. Turnkey Co-Sign | Custom `gpg.program` | Turnkey SDK integration, signing relay | Passkey approval prompt | Turnkey |
| 3. Sigstore | Install gitsign, configure git | OIDC token relay | OIDC auth flow | Sigstore/Rekor |
| 4. Signing Proxy | Custom `gpg.program` | Signature relay via WebSocket | Browser extension or native agent | User's local GPG setup |
| 5. Bot Account | Standard git signing config | Bot key management | None | Org-managed bot account |

## Open Questions

1. **Which orgs need this first, and what does their policy actually accept?** The right approach depends on whether the policy says "keys on hardware" or "cryptographic proof of author identity."
2. **What's Valet's acceptable trust boundary?** If Valet custodies a signing key (Approach 1), what's the blast radius of a compromise? Is that acceptable?
3. **Can we offer multiple approaches?** Per-org configuration where strict orgs use co-signing and others use platform-managed keys.
4. **How does this interact with multiplayer sessions?** If multiple users send prompts, whose key signs the resulting commits?
5. **Merge commit signing** — When Valet merges PRs via GitHub API, does the signing happen through GitHub's merge mechanism (which uses the user's GitHub-registered key) or does Valet need to sign merges locally?

## Recommendation

No single approach is recommended yet. The decision depends on the security posture assessment. However, the approaches are not mutually exclusive — Valet could support a configurable signing backend per org:

- **Default:** Approach 1 (platform-managed keys) for orgs that just need "Verified" badges
- **Strict:** Approach 2 (Turnkey co-signing) for orgs with hardware-custody mandates
- **Keyless:** Approach 3 (Sigstore) for orgs that accept OIDC-based identity attestation
