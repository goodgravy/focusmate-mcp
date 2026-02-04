# FocusMate MCP Connector Brainstorm

**Date**: 2026-02-02
**Author**: James Brady

## What We're Building

An MCP (Model Context Protocol) server that enables Claude to interact with FocusMate for weekly planning workflows. The connector will allow programmatic booking and cancellation of FocusMate sessions, plus querying session history.

### Primary Use Case

When doing weekly planning, James wants to block specific times for focused work by programmatically creating FocusMate sessions—turning calendar planning into booked accountability sessions in one flow.

## Why This Approach

### The Core Constraint

**FocusMate's public API is read-only.** Per their [blog announcement](https://www.focusmate.com/blog/focusmate-public-api/) and [Microsoft connector docs](https://learn.microsoft.com/en-us/connectors/focusmateip/), the API only supports:
- Get user profile
- Get partner profile
- Get sessions (history query)

Booking and cancellation are explicitly listed as "potential future features."

### Our Solution: Hybrid Approach

1. **Browser automation** (Playwright) for booking and cancellation
2. **Read-only API** for querying session history (more reliable, faster)

This gives us the functionality we need while using the stable API where possible.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Language** | TypeScript | Better debugging DX, strong typing, excellent VS Code integration |
| **Browser automation** | Playwright | First-class TypeScript support, handles modern SPAs, cross-browser |
| **MCP SDK** | Official `@modelcontextprotocol/sdk` | Production-ready, Zod validation |
| **Authentication** | Stored session cookies | Simple, low maintenance—log in manually once, reuse cookies |

## MCP Tools to Expose

### `book_session`
- **Input**: date, time, duration (25/50/75 min)
- **Implementation**: Playwright browser automation
- **Returns**: session ID, confirmation details

### `cancel_session`
- **Input**: session ID
- **Implementation**: Playwright browser automation
- **Returns**: confirmation

### `list_sessions`
- **Input**: date range (start, end)
- **Implementation**: FocusMate read-only API
- **Returns**: array of sessions with times, partners, completion status

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Claude Code    │────▶│  MCP Server      │────▶│  FocusMate      │
│  (MCP Client)   │     │  (TypeScript)    │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ├── Playwright (book/cancel)
                               └── HTTP Client (list sessions)
```

## Open Questions

1. **Cookie persistence**: Where to store session cookies? Options:
   - Local file (simple)
   - System keychain (more secure)
   - Environment variable (12-factor friendly)

2. **Session expiry handling**: What happens when cookies expire?
   - Detect and prompt for re-login?
   - Attempt automated login with stored credentials?

3. **Rate limiting**: Does FocusMate have rate limits on their web interface? May need throttling.

4. **Error handling**: How to handle:
   - Time slot already booked
   - Session conflicts
   - Network failures mid-automation

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| UI changes break automation | Medium | Use stable selectors, add tests, version pin |
| Cookie expiry during planning | Low | Detect auth failures, prompt for refresh |
| FocusMate blocks automation | Low | Respectful rate limiting, user-agent honesty |

## Next Steps

1. Run `/workflows:plan` to create implementation plan
2. Set up TypeScript project with MCP SDK
3. Prototype Playwright booking flow
4. Implement cookie persistence
5. Build MCP tool handlers
