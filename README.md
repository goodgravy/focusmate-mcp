# FocusMate MCP Server

An MCP (Model Context Protocol) server that enables Claude to book, cancel, and query FocusMate accountability sessions.

## Features

- **Book sessions** - Schedule FocusMate sessions for specific dates and times
- **Cancel sessions** - Cancel existing sessions by ID
- **List sessions** - Query upcoming and past sessions within a date range
- **Interactive authentication** - Secure browser-based login with cookie persistence

## Installation

```bash
# Clone the repository
git clone https://github.com/goodgravy/focusmate-mcp.git
cd focusmate-mcp

# Install dependencies
npm install

# Build
npm run build

# Install Playwright browsers
npx playwright install chromium
```

## Configuration

### Claude Desktop

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "focusmate": {
      "command": "node",
      "args": ["/path/to/focusmate-mcp/build/index.js"]
    }
  }
}
```

Replace `/path/to/focusmate-mcp` with the actual path to your installation.

### API Key (for list_sessions)

To use the `list_sessions` tool, you need a FocusMate API key:

1. Go to [FocusMate Settings](https://www.focusmate.com/profile/edit-p)
2. Scroll to the API section and generate an API key
3. Create the config file:

```bash
mkdir -p ~/.focusmate-mcp
echo '{"apiKey": "your-api-key-here"}' > ~/.focusmate-mcp/config.json
chmod 600 ~/.focusmate-mcp/config.json
```

## Usage

### Initial Authentication

Before booking or canceling sessions, authenticate with FocusMate:

```
Use the focusmate_auth tool to log in
```

This opens a browser window where you can log in to FocusMate. Once logged in, your session is saved automatically.

### Available Tools

#### `focusmate_auth`

Open a browser window to log into FocusMate. Cookies are saved for future use.

**Parameters:**
- `force` (boolean, optional): Force re-authentication even if valid cookies exist

**Example:**
```
Authenticate with FocusMate
```

#### `book_session`

Book a FocusMate accountability session.

**Parameters:**
- `startTime` (string, required): ISO 8601 datetime for session start
- `duration` (string, optional): Session duration - "25", "50", or "75" minutes (default: "50")

**Example:**
```
Book a 50-minute FocusMate session for tomorrow at 2pm
```

Note: Sessions must start on 15-minute boundaries (e.g., 14:00, 14:15, 14:30, 14:45).

#### `cancel_session`

Cancel an existing FocusMate session.

**Parameters:**
- `sessionId` (string, required): The ID of the session to cancel

**Example:**
```
Cancel my FocusMate session with ID abc123
```

#### `list_sessions`

List FocusMate sessions within a date range.

**Parameters:**
- `startDate` (string, required): Start of date range (ISO 8601)
- `endDate` (string, optional): End of date range (defaults to 7 days from startDate)

**Example:**
```
Show my FocusMate sessions for this week
```

## Error Codes

| Code | Meaning | Solution |
|------|---------|----------|
| `AUTH_EXPIRED` | Session cookies have expired | Run `focusmate_auth` to log in again |
| `SLOT_UNAVAILABLE` | The requested time slot is taken | Choose a different time |
| `SESSION_CONFLICT` | You already have a session at that time | Cancel the existing session or choose a different time |
| `INVALID_TIME` | Time doesn't match valid 15-minute slots | Use a time like :00, :15, :30, or :45 |
| `SESSION_NOT_FOUND` | Session ID doesn't exist | Check the session ID with `list_sessions` |
| `CONFIG_ERROR` | API key not configured | Add API key to `~/.focusmate-mcp/config.json` |
| `AUTOMATION_FAILED` | Browser automation error | Check the screenshot in `~/.focusmate-mcp/screenshots/` |

## File Locations

- **Cookies**: `~/.focusmate-mcp/cookies.json`
- **Config**: `~/.focusmate-mcp/config.json`
- **Screenshots**: `~/.focusmate-mcp/screenshots/`

## Development

```bash
# Run in development mode
npm run dev

# Run tests
npm test

# Type check
npm run lint
```

## Troubleshooting

### "Authentication expired" errors

Run `focusmate_auth` to log in again. FocusMate sessions typically expire after several hours of inactivity.

### Booking fails with no clear error

Check for screenshots in `~/.focusmate-mcp/screenshots/`. The automation captures a screenshot when it fails, which can help diagnose UI changes or unexpected states.

### "API key not configured" for list_sessions

The `list_sessions` tool uses FocusMate's official API, which requires an API key. Book and cancel operations use browser automation and only need cookies from `focusmate_auth`.

### Browser doesn't open for authentication

Ensure Playwright browsers are installed:
```bash
npx playwright install chromium
```

## Limitations

- **Read-only API**: FocusMate's official API only supports reading data. Booking and cancellation use browser automation, which may break if FocusMate changes their UI.
- **Rate limiting**: The API has a limit of 100 requests per minute. Browser automation is naturally slower and shouldn't hit limits.
- **Session duration**: Only 25, 50, and 75-minute sessions are supported (FocusMate's standard options).

## License

MIT
