---
# agent-ops-k8rt
title: 'Multi-runtime sandbox abstraction (Modal + Kubernetes)'
status: todo
type: epic
priority: medium
tags:
    - backend
    - worker
    - sandbox
    - architecture
    - research
created_at: 2026-02-19T22:00:00Z
updated_at: 2026-02-19T22:00:00Z
---

Introduce a runtime abstraction layer so agent-ops can run sandboxes on Modal (current) or Kubernetes (via the [kubernetes-sigs/agent-sandbox](https://github.com/kubernetes-sigs/agent-sandbox) project), with the door open for future runtimes.

## Problem Space

Today the sandbox lifecycle is tightly coupled to Modal. The SessionAgentDO makes raw `fetch()` calls to 4 Modal-specific URLs (create-session, terminate-session, hibernate-session, restore-session), and the Python backend (`backend/sandboxes.py`) wraps the Modal SDK directly. There is no shared contract, no runtime abstraction, and no way to swap the backing infrastructure without touching the DO.

This creates several constraints:

1. **Vendor lock-in**: Modal is the only option. If Modal has outages, pricing changes, or feature gaps, there's no fallback.
2. **Self-hosted path blocked**: Users who want to run agent-ops on their own infrastructure (on-prem K8s, EKS, GKE) cannot do so without rewriting the backend.
3. **Cold-start latency**: Modal sandbox boot is 30-60s. K8s Agent Sandbox has a `SandboxWarmPool` CRD that maintains pre-initialized pods for near-instant allocation.
4. **Isolation flexibility**: Modal provides one isolation model. K8s Agent Sandbox supports gVisor, Kata Containers, and (on roadmap) Firecracker/QEMU, allowing users to pick the security/performance tradeoff.
5. **Cost structure**: Modal charges per-second compute. K8s on existing clusters amortizes cost across workloads. For high-volume deployments, K8s may be significantly cheaper.

## Current Architecture (What Exists)

The sandbox call path is:

```
Worker Routes (sessions.ts, orchestrator.ts)
  --> constructs 4 Modal URLs from MODAL_BACKEND_URL template
  --> passes them + spawnRequest JSON blob to SessionAgentDO /start

SessionAgentDO (session-agent.ts)
  --> stores URLs + spawnRequest in durable state
  --> fetch(backendUrl, { body: spawnRequest })     // create
  --> fetch(terminateUrl, { body: { sandboxId } })  // terminate
  --> fetch(hibernateUrl, { body: { sandboxId } })  // hibernate -> snapshotImageId
  --> fetch(restoreUrl, { body: { ...spawnRequest, snapshotImageId } })  // wake

Modal Backend (app.py -> session.py -> sandboxes.py)
  --> 6 FastAPI endpoints: create, terminate, hibernate, restore, status, delete-workspace
  --> SandboxManager wraps Modal SDK (modal.Sandbox, modal.Volume, modal.Image)
```

Key observations:
- The DO has **no abstraction class** for backend calls — it's raw fetch() with hardcoded JSON shapes
- The 4 URLs are opaque strings passed through from route construction, which is actually a decent foundation
- `spawnRequest` is a Modal-specific blob (image_type, doWsUrl, envVars, etc.)
- Hibernate returns a `snapshotImageId` (Modal filesystem snapshot) which is inherently Modal-specific
- The Python `SandboxManager` is the only real abstraction layer, but it's server-side only

## K8s Agent Sandbox — What It Provides

The [agent-sandbox](https://agent-sandbox.sigs.k8s.io/) project (SIG Apps, v1alpha1) defines:

**Core CRD — `Sandbox`**:
```yaml
apiVersion: agents.x-k8s.io/v1alpha1
kind: Sandbox
spec:
  replicas: 1              # 0 to pause, 1 to run
  podTemplate:
    spec:
      containers:
      - name: agent
        image: our-sandbox-image:latest
  volumeClaimTemplates: [] # persistent storage
  lifecycle:
    shutdownTime: "..."    # auto-deletion
    shutdownPolicy: Retain # or Delete
```

**Extension CRDs**:
- `SandboxTemplate` — reusable sandbox configs (maps to our image types / repo-specific images)
- `SandboxClaim` — user-facing abstraction over templates
- `SandboxWarmPool` — pre-initialized pods for fast allocation

**Status**:
- `serviceFQDN` — stable DNS for the sandbox (e.g., `sandbox-abc.ns.svc.cluster.local`)
- `replicas` — actual running count
- Conditions for lifecycle state tracking

**Lifecycle**:
- Create: apply Sandbox CR, controller creates Pod + PVC + headless Service
- Pause: set `replicas: 0`, pod is terminated but PVC + Service persist
- Resume: set `replicas: 1`, pod restarts with same PVC and identity
- Delete: remove Sandbox CR, cleanup based on shutdownPolicy

**Key difference from Modal**: Pause/resume is PVC-based (persistent volume survives pod termination), NOT filesystem-snapshot-based. There is no "snapshot image ID" concept — the sandbox identity and storage are continuous.

## Design: Runtime Provider Abstraction

### HTTP Contract (Shared Across All Runtimes)

Formalize the existing 6-endpoint HTTP API as the universal contract. Every runtime backend implements these same endpoints:

```
POST /create-session     -> { sandboxId, tunnelUrls }
POST /terminate-session  -> { ok }
POST /hibernate-session  -> { snapshotRef }         # opaque string
POST /restore-session    -> { sandboxId, tunnelUrls }
POST /session-status     -> { status }
POST /delete-workspace   -> { ok }
```

The `snapshotRef` replaces `snapshotImageId` — it's an opaque string whose meaning varies by runtime:
- Modal: a Modal Image object ID (used to create a new sandbox from snapshot)
- K8s: the Sandbox CR name (resume = scale replicas back to 1, no new identity needed)

### Data Model Changes

**D1 sessions table**:
```sql
ALTER TABLE sessions ADD COLUMN runtime TEXT NOT NULL DEFAULT 'modal';
-- values: 'modal', 'k8s', future runtimes
```

**Shared types**:
```typescript
type SandboxRuntime = 'modal' | 'k8s';

interface Session {
  // ...existing fields
  runtime: SandboxRuntime;
}
```

**Worker env**:
```toml
# wrangler.toml / secrets
MODAL_BACKEND_URL = "https://...modal.run/{label}"
K8S_BACKEND_URL = "https://k8s-sandbox-api.example.com/{label}"  # when available
```

### Runtime Selection

Route-level logic selects the backend URL set based on the requested runtime:

```typescript
// In session creation routes
const runtime = body.runtime ?? 'modal';
const backendBaseUrl = runtime === 'k8s' ? c.env.K8S_BACKEND_URL : c.env.MODAL_BACKEND_URL;
const urls = {
  backendUrl:   backendBaseUrl.replace('{label}', 'create-session'),
  terminateUrl: backendBaseUrl.replace('{label}', 'terminate-session'),
  hibernateUrl: backendBaseUrl.replace('{label}', 'hibernate-session'),
  restoreUrl:   backendBaseUrl.replace('{label}', 'restore-session'),
};
```

The DO itself doesn't change — it already treats URLs as opaque strings.

### K8s Backend Service

A new service (Python FastAPI or Go) deployed in-cluster that implements the 6-endpoint contract:

```
POST /create-session:
  1. Apply Sandbox CR (from SandboxTemplate or inline spec)
  2. Inject env vars as ConfigMap/Secret
  3. Wait for Pod ready + Service FQDN
  4. Return { sandboxId: CR name, tunnelUrls: { gateway: "https://...", ... } }

POST /terminate-session:
  1. Delete Sandbox CR (shutdownPolicy: Delete)

POST /hibernate-session:
  1. Patch Sandbox CR: replicas = 0
  2. Return { snapshotRef: sandbox CR name }  # same identity, PVC persists

POST /restore-session:
  1. Patch Sandbox CR: replicas = 1
  2. Wait for Pod ready
  3. Return { sandboxId: CR name, tunnelUrls: { ... } }

POST /session-status:
  1. Get Sandbox CR status, map to running/terminated/paused

POST /delete-workspace:
  1. Delete Sandbox CR + associated PVCs
```

### Networking / Tunnel URLs

This is the hardest gap. Modal provides encrypted tunnel URLs automatically. K8s options:

1. **Cloudflare Tunnel sidecar**: Run `cloudflared` as a sidecar container in each sandbox pod. On pod start, it registers a tunnel and reports the URL. The K8s backend service reads the URL from a pod annotation or status field.
2. **Ingress per sandbox**: Create an Ingress resource per Sandbox CR with a unique subdomain (e.g., `sandbox-abc.agent-ops.example.com`). Requires wildcard DNS + cert.
3. **K8s Service + external LoadBalancer**: Each sandbox gets a headless Service (already provided by Agent Sandbox). Expose via a shared gateway/reverse proxy that routes by sandbox ID.

Option 1 (Cloudflare Tunnel) is the closest to the current Modal tunnel model and integrates naturally with the existing Cloudflare Worker architecture.

### Image Building

- Modal: `backend/images/base.py` uses Modal's image builder (`.from_registry().run_commands()...`)
- K8s: Standard Dockerfile, built with CI (GitHub Actions, Cloud Build) and pushed to a container registry
- The same `docker/start.sh` and `packages/runner/` are installed in both — the sandbox interior is identical regardless of runtime
- `SandboxTemplate` CRD maps to image type (base, repo-specific, etc.)

## Open Questions

1. **Runtime selection granularity**: Per-org setting? Per-session choice? Global deployment config? Start with per-session (most flexible), default to the org's configured runtime.

2. **Mixed-runtime deployments**: Can a single agent-ops deployment run both Modal and K8s sandboxes simultaneously? The architecture supports it (just different URL sets per session), but operational complexity increases.

3. **Warm pool management**: Who configures `SandboxWarmPool` CRDs? Admin API? Static config? This is a K8s-only concept that doesn't map to Modal.

4. **K8s cluster provisioning**: Out of scope for agent-ops itself, but we should document the requirements (Agent Sandbox controller installed, gVisor runtime class available, PVC storage class, etc.).

5. **Hibernate/wake semantic differences**: Modal creates a fresh sandbox from a snapshot (new sandbox ID, new tunnel URLs). K8s resumes the same sandbox (same ID, same PVC, but new pod IP → new tunnel URLs from cloudflared). The DO already handles tunnel URL updates on wake, but the `sandboxId` stability difference may surface in edge cases.

6. **Agent Sandbox maturity**: The project is v1alpha1. The roadmap shows key features still in progress (status updates, strict sandbox-to-pod mapping, scale-down/resume PVC-based). Need to evaluate whether it's stable enough for production use or if we'd be building on a moving target.

## Implementation Phases

### Phase 0: Formalize the contract (no runtime changes)
- Define the 6-endpoint HTTP API as a shared schema (OpenAPI or TypeScript types in `packages/shared`)
- Add `runtime` column to sessions table (default 'modal', no UI yet)
- Add `runtime` field to shared Session type
- Refactor URL construction in session/orchestrator routes to use a helper that selects URLs by runtime
- **Zero behavior change** — this is pure prep work

### Phase 1: K8s backend service (proof of concept)
- Build the K8s backend service implementing the 6-endpoint contract
- Target a local K8s cluster (minikube/kind) with Agent Sandbox controller installed
- Use the same sandbox Docker image (multi-arch build from existing Dockerfile/start.sh)
- Validate create → prompt → hibernate → wake → terminate lifecycle
- Networking: start with port-forward or NodePort (not production-grade)

### Phase 2: Production networking
- Cloudflare Tunnel sidecar for sandbox pods
- Tunnel URL reporting back to the K8s backend service
- End-to-end test: Worker → K8s backend → sandbox pod with tunnel URLs → Runner WS → DO

### Phase 3: Frontend + configuration
- Runtime selector in session creation UI
- Per-org default runtime setting (admin API)
- K8s warm pool configuration (admin API or static config)
- Runtime badge on session cards

## Acceptance Criteria

- [ ] HTTP contract formalized as shared types
- [ ] `runtime` field on sessions (D1 + shared types)
- [ ] URL construction supports multiple runtimes
- [ ] K8s backend service implements the 6-endpoint contract
- [ ] Full session lifecycle works on K8s (create, prompt, hibernate, wake, terminate)
- [ ] Tunnel URLs work for K8s sandboxes (gateway, VNC, terminal accessible from browser)
- [ ] Modal continues to work unchanged (no regression)
- [ ] Runtime selectable per-session via API
