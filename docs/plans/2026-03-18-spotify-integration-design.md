# Spotify Integration Design

**Date:** 2026-03-18
**Status:** Approved

## Overview

A Spotify plugin (`packages/plugin-spotify/`) that exposes the full Spotify Web API as agent tools. Read and write operations across user library, playlists, search, recommendations, and playback control. Actions only — no webhook triggers (Spotify has no public webhook API).

Concert/event cross-referencing is out of scope; the agent can orchestrate that via web search or a separate events integration.

## Plugin Structure

```
packages/plugin-spotify/
├── plugin.yaml
├── package.json
├── tsconfig.json
└── src/
    └── actions/
        ├── index.ts       # IntegrationPackage export
        ├── provider.ts    # OAuth2 provider
        ├── actions.ts     # ActionSource with all actions
        └── api.ts         # Spotify API fetch wrapper
```

Code plugin compiled into the worker. Auto-registered via `make generate-registries`.

## Authentication

**Flow:** OAuth2 Authorization Code (server-side). Spotify requires a client secret for token refresh regardless of PKCE usage.

**Env vars:** `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` (worker bindings).

**Token refresh:** Access tokens expire in 1 hour. Provider implements `refreshOAuthTokens()` using the refresh token grant.

**OAuth scopes:**

| Scope | Purpose |
|-------|---------|
| `user-read-private` | User profile |
| `user-read-email` | User email |
| `user-top-read` | Top artists/tracks |
| `user-library-read` | Saved tracks/albums/shows |
| `user-library-modify` | Save/remove library items |
| `user-follow-read` | Followed artists |
| `user-follow-modify` | Follow/unfollow artists |
| `playlist-read-private` | Private playlists |
| `playlist-read-collaborative` | Collaborative playlists |
| `playlist-modify-public` | Create/modify public playlists |
| `playlist-modify-private` | Create/modify private playlists |
| `user-read-playback-state` | Current playback state |
| `user-modify-playback-state` | Control playback |
| `user-read-currently-playing` | Currently playing track |
| `user-read-recently-played` | Recently played tracks |

## Action Catalog

35 actions organized into 6 namespaced groups. Read operations are `low` risk; write operations are `medium` risk (trigger approval gates).

### `spotify.user.*` (all low risk)

| Action | Description |
|--------|-------------|
| `spotify.user.get_profile` | Get current user's profile |
| `spotify.user.get_top_artists` | Get top artists (short/medium/long term) |
| `spotify.user.get_top_tracks` | Get top tracks (short/medium/long term) |
| `spotify.user.get_recently_played` | Get recently played tracks |

### `spotify.library.*`

| Action | Risk | Description |
|--------|------|-------------|
| `spotify.library.get_saved_tracks` | low | List saved tracks (paginated) |
| `spotify.library.get_saved_albums` | low | List saved albums (paginated) |
| `spotify.library.get_saved_shows` | low | List saved shows (paginated) |
| `spotify.library.get_followed_artists` | low | List followed artists |
| `spotify.library.save_tracks` | medium | Save tracks to library |
| `spotify.library.remove_tracks` | medium | Remove tracks from library |
| `spotify.library.save_albums` | medium | Save albums to library |
| `spotify.library.remove_albums` | medium | Remove albums from library |
| `spotify.library.follow_artists` | medium | Follow artists |
| `spotify.library.unfollow_artists` | medium | Unfollow artists |

### `spotify.playlists.*`

| Action | Risk | Description |
|--------|------|-------------|
| `spotify.playlists.list` | low | List current user's playlists |
| `spotify.playlists.get` | low | Get playlist details + tracks |
| `spotify.playlists.create` | medium | Create a new playlist |
| `spotify.playlists.update` | medium | Update playlist name/description/visibility |
| `spotify.playlists.add_tracks` | medium | Add tracks to a playlist |
| `spotify.playlists.remove_tracks` | medium | Remove tracks from a playlist |
| `spotify.playlists.reorder_tracks` | medium | Reorder tracks in a playlist |

### `spotify.search.*` (all low risk)

| Action | Risk | Description |
|--------|------|-------------|
| `spotify.search.query` | low | Search catalog (artists, tracks, albums, playlists, shows) |
| `spotify.search.get_artist` | low | Get artist details, albums, top tracks, related artists |
| `spotify.search.get_album` | low | Get album details + tracks |
| `spotify.search.get_track` | low | Get track details + audio features |

### `spotify.recommendations.*` (all low risk)

| Action | Risk | Description |
|--------|------|-------------|
| `spotify.recommendations.get` | low | Get recommendations from seed artists/tracks/genres |
| `spotify.recommendations.get_genres` | low | List available genre seeds |

### `spotify.playback.*`

| Action | Risk | Description |
|--------|------|-------------|
| `spotify.playback.get_state` | low | Get current playback state |
| `spotify.playback.get_devices` | low | List available devices |
| `spotify.playback.play` | medium | Start/resume playback (optionally with context URI) |
| `spotify.playback.pause` | medium | Pause playback |
| `spotify.playback.skip_next` | medium | Skip to next track |
| `spotify.playback.skip_previous` | medium | Skip to previous track |
| `spotify.playback.seek` | medium | Seek to position |
| `spotify.playback.set_volume` | medium | Set volume |
| `spotify.playback.toggle_shuffle` | medium | Toggle shuffle |
| `spotify.playback.set_repeat` | medium | Set repeat mode (off/track/context) |
| `spotify.playback.add_to_queue` | medium | Add track to queue |

## API Helper & Error Handling

- **Base URL:** `https://api.spotify.com/v1`
- **Auth:** `Authorization: Bearer {access_token}` from `ActionContext.credentials`
- **Pagination:** List actions accept `limit` (default 20, max 50) and `offset`. Results include `total`, `next`, `offset`.
- **Rate limiting:** On 429, return failed `ActionResult` with `Retry-After` value in error message.
- **Error mapping:** Spotify's `{ error: { status, message } }` mapped to `ActionResult.error`. Key cases: 401 (triggers token refresh), 403 (scope issue), 404 (not found), 429 (rate limited).
- **No caching:** Per Spotify developer terms.
- **No response transformation:** Raw Spotify JSON returned directly.

## Out of Scope

- Webhook triggers (Spotify has no public webhook API)
- Concert/event data (separate integration or web search)
- Podcast episode playback actions (can be added later)
- Spotify Connect device transfer (can be added later)
