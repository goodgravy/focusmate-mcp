---
title: "feat: FocusMate MCP Connector"
type: feat
date: 2026-02-02
---

# feat: FocusMate MCP Connector

## Overview

Build an MCP server that enables Claude to book, cancel, and query FocusMate sessions for weekly planning workflows. Since FocusMate's public API is read-only, we'll use a hybrid approach: Playwright browser automation for booking/cancellation, and the official API for session queries.

## Problem Statement / Motivation

When doing weekly planning, James wants to block specific times for focused work by programmatically creating FocusMate accountability sessions. Currently this requires manually navigating to FocusMate's web interface for each session—interrupting the planning flow and adding friction.

**Goal:** Turn "I want a FocusMate session at 2pm Monday" into a single Claude command.

## Proposed Solution

A TypeScript MCP server with three tools:

| Tool | Method | Purpose |
|------|--------|---------|
| `focusmate_auth` | Playwright (headed) | Interactive login to capture/refresh cookies |
| `book_session` | Playwright (headless) | Book a session for a specific date/time/duration |
| `cancel_session` | Playwright (headless) | Cancel an existing session |
| `list_sessions` | FocusMate API | Query upcoming and past sessions |

### Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────┐     ┌─────────────────┐
│  Claude Code    │────▶│  focusmate-mcp (TypeScript)          │────▶│  FocusMate      │
│  (MCP Client)   │     │                                      │     │                 │
└─────────────────┘     │  ┌─────────────────────────────────┐ │     └─────────────────┘
                        │  │ Tools:                          │ │
                        │  │  • focusmate_auth (Playwright)  │ │
                        │  │  • book_session (Playwright)    │ │
                        │  │  • cancel_session (Playwright)  │ │
                        │  │  • list_sessions (HTTP API)     │ │
                        │  └─────────────────────────────────┘ │
                        │                                      │
                        │  ┌─────────────────────────────────┐ │
                        │  │ State:                          │ │
                        │  │  • ~/.focusmate-mcp/cookies.json│ │
                        │  │  • ~/.focusmate-mcp/config.json │ │
                        │  └─────────────────────────────────┘ │
                        └──────────────────────────────────────┘
```

## Technical Considerations

### Authentication Strategy

1. **Initial setup:** `focusmate_auth` opens a headed browser, user logs in manually, cookies saved to `~/.focusmate-mcp/cookies.json`
2. **Subsequent use:** Playwright loads cookies in headless mode
3. **Expiry detection:** If Playwright detects redirect to login page, return `AUTH_EXPIRED` error prompting user to run `focusmate_auth`
4. **API access:** For `list_sessions`, use FocusMate API key (user generates in FocusMate settings, stored in config)

### Timezone Handling

- All input times interpreted as user's local timezone (from system)
- Internal storage and API calls use ISO 8601 with timezone offset
- Display times converted back to local timezone

### FocusMate Constraints (to discover during implementation)

- Valid booking slots (likely :00 and :30)
- Minimum advance notice for booking
- Maximum future booking window
- Session cancellation deadline

### Playwright Resilience

- Use role-based selectors (`getByRole`) over CSS classes
- Capture screenshots on failure for debugging
- Implement retry logic with state checks (avoid double-booking)

### Error Taxonomy

| Error Code | Meaning | User Action |
|------------|---------|-------------|
| `AUTH_EXPIRED` | Cookies invalid/expired | Run `focusmate_auth` |
| `SLOT_UNAVAILABLE` | Time slot already taken | Choose different time |
| `SESSION_CONFLICT` | User has existing session at that time | Cancel existing or choose different time |
| `INVALID_TIME` | Time doesn't match valid FocusMate slots | Use valid slot (e.g., :00, :30) |
| `SESSION_NOT_FOUND` | Session ID doesn't exist | Verify session ID with `list_sessions` |
| `AUTOMATION_FAILED` | Playwright error (element not found, timeout) | Retry or report bug |

## Acceptance Criteria

### Core Functionality

- [x] `focusmate_auth` opens browser, waits for login, saves cookies
- [x] `book_session` books a session with date, time, duration (25/50/75 min)
- [x] `cancel_session` cancels a session by ID
- [x] `list_sessions` returns sessions in a date range

### Input/Output Contracts

- [x] `book_session` accepts ISO 8601 datetime (natural language deferred to Claude)
- [x] `book_session` returns session ID, start time, end time, status
- [x] `list_sessions` returns array with: id, startTime, endTime, duration, partnerName (if matched), status
- [x] All tools return structured JSON (via MCP output schema)

### Error Handling

- [x] Auth expiry detected and returns `AUTH_EXPIRED` with clear message
- [x] Slot unavailable returns `SLOT_UNAVAILABLE` with available alternatives if possible
- [x] Screenshots saved on automation failure

### Developer Experience

- [x] Works with Claude Desktop via stdio transport
- [x] Clear setup instructions in README
- [x] Config stored in `~/.focusmate-mcp/`

## Dependencies & Risks

### Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `@modelcontextprotocol/sdk` | ^1.x | MCP server framework |
| `playwright` | ^1.x | Browser automation |
| `zod` | ^3.25 | Schema validation |

### Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| FocusMate UI changes break automation | Medium | Use stable selectors, add visual regression tests, version pin |
| FocusMate blocks automation | Low | Respectful rate limiting, honest user-agent |
| Cookie expiry during planning session | Low | Detect early, clear error message |
| FocusMate ToS prohibits automation | Unknown | Review ToS before publishing |

## Project Structure

```
focusmate-mcp/
├── src/
│   ├── index.ts                    # Entry point, server setup
│   ├── server.ts                   # MCP server configuration
│   ├── tools/
│   │   ├── focusmate-auth.ts       # Interactive login tool
│   │   ├── book-session.ts         # Booking automation
│   │   ├── cancel-session.ts       # Cancellation automation
│   │   └── list-sessions.ts        # API-based session query
│   ├── automation/
│   │   ├── browser.ts              # Playwright browser management
│   │   ├── pages/
│   │   │   ├── login.ts            # Login page object
│   │   │   ├── dashboard.ts        # Dashboard page object
│   │   │   └── booking.ts          # Booking flow page object
│   │   └── cookies.ts              # Cookie persistence
│   ├── api/
│   │   └── focusmate-client.ts     # HTTP client for read-only API
│   ├── schemas/
│   │   └── session.ts              # Zod schemas
│   └── utils/
│       ├── errors.ts               # Custom error classes
│       └── time.ts                 # Timezone handling
├── tests/
│   ├── tools/
│   │   └── *.test.ts
│   └── helpers/
│       └── test-client.ts          # In-memory MCP test client
├── docs/
│   ├── brainstorms/
│   └── plans/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

## Implementation Phases

### Phase 1: Foundation
- [x] Initialize TypeScript project with MCP SDK
- [x] Set up Playwright and basic browser management
- [x] Implement cookie persistence (`~/.focusmate-mcp/cookies.json`)
- [x] Create `focusmate_auth` tool (interactive login)

### Phase 2: Booking Automation
- [x] Reverse-engineer FocusMate booking flow (selectors, API calls)
- [x] Implement Page Object Model for booking
- [x] Create `book_session` tool with duration support
- [x] Add retry logic and screenshot-on-failure

### Phase 3: Cancellation & Query
- [x] Implement `cancel_session` tool
- [x] Set up FocusMate API client with API key auth
- [x] Create `list_sessions` tool
- [x] Define output schemas for all tools

### Phase 4: Polish
- [x] Add comprehensive error handling
- [ ] Write tests (unit + integration)
- [x] Create README with setup instructions
- [ ] Test end-to-end with Claude Desktop

## References & Research

### Internal References
- Brainstorm: `docs/brainstorms/2026-02-02-focusmate-mcp-connector-brainstorm.md`

### External References
- [FocusMate API Docs](https://apidocs.focusmate.com/) - Read-only API
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Playwright Auth Guide](https://playwright.dev/docs/auth)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)

### AI Tools Used
- Claude Code for research and planning
