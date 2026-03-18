# Spotify Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `plugin-spotify` package that exposes the full Spotify Web API (library, playlists, search, recommendations, playback) as 35 agent actions with OAuth2 authentication.

**Architecture:** Standard Valet code plugin following the `plugin-github` pattern — OAuth2 provider with token refresh, custom ActionSource with fine-grained namespaced actions, thin fetch wrapper. No triggers (Spotify has no webhook API).

**Tech Stack:** TypeScript, Zod (param validation), `@valet/sdk` (IntegrationProvider, ActionSource interfaces)

**Design doc:** `docs/plans/2026-03-18-spotify-integration-design.md`

---

### Task 1: Scaffold plugin package

**Files:**
- Create: `packages/plugin-spotify/plugin.yaml`
- Create: `packages/plugin-spotify/package.json`
- Create: `packages/plugin-spotify/tsconfig.json`

**Step 1: Create plugin.yaml**

```yaml
name: spotify
version: 0.0.1
description: Spotify integration for music library, playlists, search, recommendations, and playback control
icon: "🎵"
```

**Step 2: Create package.json**

```json
{
  "name": "@valet/plugin-spotify",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    "./actions": "./src/actions/index.ts"
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@valet/sdk": "workspace:*",
    "@valet/shared": "workspace:*",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "typescript": "^5.3.3"
  }
}
```

**Step 3: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": []
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../sdk" },
    { "path": "../shared" }
  ]
}
```

**Step 4: Add plugin reference to root tsconfig.json**

Add `{ "path": "./packages/plugin-spotify" }` to the `references` array in `/tsconfig.json`.

**Step 5: Add plugin reference to worker tsconfig.json**

Add `{ "path": "../plugin-spotify" }` to the `references` array in `packages/worker/tsconfig.json`.

**Step 6: Add plugin dependency to worker package.json**

Add `"@valet/plugin-spotify": "workspace:*"` to `dependencies` in `packages/worker/package.json`.

**Step 7: Install dependencies**

Run: `pnpm install`

**Step 8: Commit**

```
feat(plugin-spotify): scaffold plugin package
```

---

### Task 2: API helper

**Files:**
- Create: `packages/plugin-spotify/src/actions/api.ts`

**Step 1: Write the API helper**

```typescript
const SPOTIFY_API = 'https://api.spotify.com';

/** Stateless authenticated fetch against the Spotify Web API. */
export async function spotifyFetch(
  path: string,
  token: string,
  options?: RequestInit,
): Promise<Response> {
  return fetch(`${SPOTIFY_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Valet/1.0',
      ...options?.headers,
    },
  });
}
```

**Step 2: Commit**

```
feat(plugin-spotify): add Spotify API fetch helper
```

---

### Task 3: OAuth2 provider

**Files:**
- Create: `packages/plugin-spotify/src/actions/provider.ts`

**Step 1: Write the provider**

Implement `IntegrationProvider` with:
- `service: 'spotify'`
- `authType: 'oauth2'`
- `supportedEntities: ['tracks', 'albums', 'artists', 'playlists', 'shows', 'devices', 'user_profile']`
- `oauthScopes`: all 15 scopes from the design doc
- `oauthEnvKeys: { clientId: 'SPOTIFY_CLIENT_ID', clientSecret: 'SPOTIFY_CLIENT_SECRET' }`
- `validateCredentials`: check `credentials.access_token` is truthy
- `testConnection`: GET `/v1/me` using `spotifyFetch`, return `res.ok`
- `getOAuthUrl`: build `https://accounts.spotify.com/authorize` URL with `response_type=code`, all scopes space-separated, `redirect_uri`, `state`, `client_id`
- `exchangeOAuthCode`: POST `https://accounts.spotify.com/api/token` with `grant_type=authorization_code`, Basic auth header (`base64(clientId:clientSecret)`), return `{ access_token, token_type, scope, refresh_token, expires_in }`
- `refreshOAuthTokens`: POST `https://accounts.spotify.com/api/token` with `grant_type=refresh_token`, Basic auth header, return new credentials

**Key difference from GitHub:** Spotify uses Basic auth header for token exchange (not JSON body with client_secret), and returns `refresh_token` + `expires_in` (GitHub tokens don't expire).

**Step 2: Verify typecheck**

Run: `cd packages/plugin-spotify && pnpm typecheck`

**Step 3: Commit**

```
feat(plugin-spotify): add OAuth2 provider with token refresh
```

---

### Task 4: User actions (spotify.user.*)

**Files:**
- Create: `packages/plugin-spotify/src/actions/actions.ts` (start with user group, will grow in subsequent tasks)

**Step 1: Write action definitions and handlers for:**

| Action ID | Method | Endpoint | Params |
|-----------|--------|----------|--------|
| `spotify.user.get_profile` | GET | `/v1/me` | — |
| `spotify.user.get_top_artists` | GET | `/v1/me/top/artists` | `timeRange?: 'short_term' \| 'medium_term' \| 'long_term'`, `limit?: number`, `offset?: number` |
| `spotify.user.get_top_tracks` | GET | `/v1/me/top/tracks` | `timeRange?: 'short_term' \| 'medium_term' \| 'long_term'`, `limit?: number`, `offset?: number` |
| `spotify.user.get_recently_played` | GET | `/v1/me/player/recently-played` | `limit?: number` |

All `riskLevel: 'low'`.

Follow the `plugin-github` pattern: define each `ActionDefinition` with Zod params, then implement handlers in a switch statement inside `executeAction`. Export `spotifyActions: ActionSource` with `listActions` and `execute`.

Use the `getToken` helper pattern from GitHub:
```typescript
function getToken(ctx: ActionContext): string {
  return ctx.credentials.access_token || '';
}
```

Map Spotify `time_range` query param from camelCase `timeRange` param.

**Step 2: Verify typecheck**

Run: `cd packages/plugin-spotify && pnpm typecheck`

**Step 3: Commit**

```
feat(plugin-spotify): add user profile and top items actions
```

---

### Task 5: Library actions (spotify.library.*)

**Files:**
- Modify: `packages/plugin-spotify/src/actions/actions.ts`

**Step 1: Add action definitions and handlers for:**

| Action ID | Risk | Method | Endpoint | Key Params |
|-----------|------|--------|----------|------------|
| `spotify.library.get_saved_tracks` | low | GET | `/v1/me/tracks` | `limit?, offset?` |
| `spotify.library.get_saved_albums` | low | GET | `/v1/me/albums` | `limit?, offset?` |
| `spotify.library.get_saved_shows` | low | GET | `/v1/me/shows` | `limit?, offset?` |
| `spotify.library.get_followed_artists` | low | GET | `/v1/me/following?type=artist` | `limit?, after?` (cursor-based) |
| `spotify.library.save_tracks` | medium | PUT | `/v1/me/tracks` | `ids: string[]` |
| `spotify.library.remove_tracks` | medium | DELETE | `/v1/me/tracks` | `ids: string[]` |
| `spotify.library.save_albums` | medium | PUT | `/v1/me/albums` | `ids: string[]` |
| `spotify.library.remove_albums` | medium | DELETE | `/v1/me/albums` | `ids: string[]` |
| `spotify.library.follow_artists` | medium | PUT | `/v1/me/following?type=artist` | `ids: string[]` |
| `spotify.library.unfollow_artists` | medium | DELETE | `/v1/me/following?type=artist` | `ids: string[]` |

Notes:
- `get_followed_artists` uses cursor-based pagination (`after` param), not offset-based
- Save/remove actions take arrays of Spotify IDs (max 50 per request per Spotify docs)
- PUT/DELETE body for tracks/albums: `{ ids: [...] }`
- PUT/DELETE for following: query param `ids=id1,id2` and body `{ ids: [...] }`

**Step 2: Verify typecheck**

Run: `cd packages/plugin-spotify && pnpm typecheck`

**Step 3: Commit**

```
feat(plugin-spotify): add library actions (saved tracks/albums/shows, follow/unfollow)
```

---

### Task 6: Playlist actions (spotify.playlists.*)

**Files:**
- Modify: `packages/plugin-spotify/src/actions/actions.ts`

**Step 1: Add action definitions and handlers for:**

| Action ID | Risk | Method | Endpoint | Key Params |
|-----------|------|--------|----------|------------|
| `spotify.playlists.list` | low | GET | `/v1/me/playlists` | `limit?, offset?` |
| `spotify.playlists.get` | low | GET | `/v1/playlists/{playlistId}` | `playlistId` |
| `spotify.playlists.create` | medium | POST | `/v1/me/playlists` | `name, description?, public?, collaborative?` |
| `spotify.playlists.update` | medium | PUT | `/v1/playlists/{playlistId}` | `playlistId, name?, description?, public?, collaborative?` |
| `spotify.playlists.add_tracks` | medium | POST | `/v1/playlists/{playlistId}/tracks` | `playlistId, uris: string[], position?` |
| `spotify.playlists.remove_tracks` | medium | DELETE | `/v1/playlists/{playlistId}/tracks` | `playlistId, uris: string[]` |
| `spotify.playlists.reorder_tracks` | medium | PUT | `/v1/playlists/{playlistId}/tracks` | `playlistId, rangeStart, insertBefore, rangeLength?` |

Notes:
- `create` POSTs to `/v1/me/playlists` (user's playlists, not `/v1/users/{id}/playlists`)
- Track URIs are in format `spotify:track:{id}`
- `remove_tracks` body: `{ tracks: [{ uri: "spotify:track:..." }, ...] }`
- `reorder_tracks` body: `{ range_start, insert_before, range_length }`

**Step 2: Verify typecheck**

Run: `cd packages/plugin-spotify && pnpm typecheck`

**Step 3: Commit**

```
feat(plugin-spotify): add playlist CRUD and track management actions
```

---

### Task 7: Search actions (spotify.search.*)

**Files:**
- Modify: `packages/plugin-spotify/src/actions/actions.ts`

**Step 1: Add action definitions and handlers for:**

| Action ID | Risk | Method | Endpoint | Key Params |
|-----------|------|--------|----------|------------|
| `spotify.search.query` | low | GET | `/v1/search` | `q, type: ('artist'\|'track'\|'album'\|'playlist'\|'show')[], limit?, offset?` |
| `spotify.search.get_artist` | low | GET | `/v1/artists/{id}` + `/v1/artists/{id}/albums` + `/v1/artists/{id}/top-tracks` + `/v1/artists/{id}/related-artists` | `artistId, include?: ('albums'\|'top_tracks'\|'related_artists')[]` |
| `spotify.search.get_album` | low | GET | `/v1/albums/{id}` | `albumId` |
| `spotify.search.get_track` | low | GET | `/v1/tracks/{id}` + `/v1/audio-features/{id}` | `trackId, includeAudioFeatures?: boolean` |

Notes:
- `search.query` `type` param maps to Spotify's comma-separated `type` query param
- `search.get_artist` fetches base artist info always, then optionally fetches albums/top-tracks/related-artists in parallel (like GitHub's `inspectPullRequest` pattern using `Promise.all`)
- `search.get_track` optionally fetches audio features (danceability, energy, tempo, etc.)

**Step 2: Verify typecheck**

Run: `cd packages/plugin-spotify && pnpm typecheck`

**Step 3: Commit**

```
feat(plugin-spotify): add search and catalog lookup actions
```

---

### Task 8: Recommendation actions (spotify.recommendations.*)

**Files:**
- Modify: `packages/plugin-spotify/src/actions/actions.ts`

**Step 1: Add action definitions and handlers for:**

| Action ID | Risk | Method | Endpoint | Key Params |
|-----------|------|--------|----------|------------|
| `spotify.recommendations.get` | low | GET | `/v1/recommendations` | `seedArtists?: string[], seedTracks?: string[], seedGenres?: string[], limit?` + tunable attributes |
| `spotify.recommendations.get_genres` | low | GET | `/v1/recommendations/available-genre-seeds` | — |

Notes:
- `recommendations.get` requires at least one seed (artists, tracks, or genres), max 5 seeds total across all types
- Seed params map to query params: `seed_artists`, `seed_tracks`, `seed_genres` (comma-separated)
- Add Zod `.refine()` to validate at least one seed is provided
- Optional tunable attributes: `minEnergy?, maxEnergy?, targetEnergy?, minTempo?, maxTempo?, targetTempo?, minDanceability?, maxDanceability?, targetDanceability?, minValence?, maxValence?, targetValence?` — map to query params like `min_energy`, `max_energy`, etc.

**Step 2: Verify typecheck**

Run: `cd packages/plugin-spotify && pnpm typecheck`

**Step 3: Commit**

```
feat(plugin-spotify): add recommendation and genre seed actions
```

---

### Task 9: Playback actions (spotify.playback.*)

**Files:**
- Modify: `packages/plugin-spotify/src/actions/actions.ts`

**Step 1: Add action definitions and handlers for:**

| Action ID | Risk | Method | Endpoint | Key Params |
|-----------|------|--------|----------|------------|
| `spotify.playback.get_state` | low | GET | `/v1/me/player` | — |
| `spotify.playback.get_devices` | low | GET | `/v1/me/player/devices` | — |
| `spotify.playback.play` | medium | PUT | `/v1/me/player/play` | `contextUri?, uris?: string[], offsetPosition?, deviceId?` |
| `spotify.playback.pause` | medium | PUT | `/v1/me/player/pause` | `deviceId?` |
| `spotify.playback.skip_next` | medium | POST | `/v1/me/player/next` | `deviceId?` |
| `spotify.playback.skip_previous` | medium | POST | `/v1/me/player/previous` | `deviceId?` |
| `spotify.playback.seek` | medium | PUT | `/v1/me/player/seek` | `positionMs, deviceId?` |
| `spotify.playback.set_volume` | medium | PUT | `/v1/me/player/volume` | `volumePercent (0-100), deviceId?` |
| `spotify.playback.toggle_shuffle` | medium | PUT | `/v1/me/player/shuffle` | `state: boolean, deviceId?` |
| `spotify.playback.set_repeat` | medium | PUT | `/v1/me/player/repeat` | `state: 'off' \| 'track' \| 'context', deviceId?` |
| `spotify.playback.add_to_queue` | medium | POST | `/v1/me/player/queue` | `uri, deviceId?` |

Notes:
- `deviceId` is always an optional query param (`?device_id=...`)
- `play` body: `{ context_uri?, uris?, offset?: { position: number } }`
- `get_state` returns 204 with no body when nothing is playing — handle this as `{ success: true, data: { is_playing: false } }`
- `seek` and `volume` use query params, not body: `/seek?position_ms=...`, `/volume?volume_percent=...`
- `shuffle` and `repeat` use query params: `/shuffle?state=true`, `/repeat?state=track`

**Step 2: Verify typecheck**

Run: `cd packages/plugin-spotify && pnpm typecheck`

**Step 3: Commit**

```
feat(plugin-spotify): add playback control actions
```

---

### Task 10: Package entry point and registration

**Files:**
- Create: `packages/plugin-spotify/src/actions/index.ts`

**Step 1: Write the entry point**

```typescript
import type { IntegrationPackage } from '@valet/sdk';
import { spotifyProvider } from './provider.js';
import { spotifyActions } from './actions.js';

export { spotifyProvider } from './provider.js';
export { spotifyActions } from './actions.js';
export { spotifyFetch } from './api.js';

const spotifyPackage: IntegrationPackage = {
  name: '@valet/actions-spotify',
  version: '0.0.1',
  service: 'spotify',
  provider: spotifyProvider,
  actions: spotifyActions,
};

export default spotifyPackage;
```

**Step 2: Regenerate plugin registries**

Run: `make generate-registries`

This auto-updates:
- `packages/worker/src/integrations/packages.ts` — adds Spotify import

**Step 3: Typecheck everything**

Run: `pnpm typecheck`

Expected: all packages pass.

**Step 4: Commit**

```
feat(plugin-spotify): add package entry point and register in worker
```

---

### Task 11: Add environment variables

**Files:**
- Modify: `packages/worker/src/env.ts` — add `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` to `Env` interface
- Modify: `packages/worker/wrangler.toml` — add secrets (if not using `.dev.vars`)

**Step 1: Add env vars to Env interface**

Add to the `Env` interface in `packages/worker/src/env.ts`:
```typescript
SPOTIFY_CLIENT_ID: string;
SPOTIFY_CLIENT_SECRET: string;
```

**Step 2: Typecheck**

Run: `pnpm typecheck`

**Step 3: Commit**

```
feat(plugin-spotify): add Spotify OAuth env vars to worker bindings
```

---

### Task 12: Final verification

**Step 1: Full typecheck**

Run: `pnpm typecheck`

**Step 2: Verify registry generation is clean**

Run: `make generate-registries && git diff`

Should show no unexpected changes (registry should already include Spotify from Task 10).

**Step 3: Review action count**

Verify all 35 actions are listed in `spotifyActions.listActions()` — 4 user + 10 library + 7 playlists + 4 search + 2 recommendations + 11 playback = 38 (adjusted from original 35 estimate after detailing params).

**Step 4: Commit any final adjustments**

```
chore(plugin-spotify): final cleanup and verification
```
