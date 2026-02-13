import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  launchPersistentContext,
  hasAuthData,
  navigateToDashboard,
  withErrorScreenshot
} from '../automation/browser.js';
import {
  ListSessionsInput,
  type ListSessionsOutput,
  type Session
} from '../schemas/session.js';
import { AuthExpiredError } from '../utils/errors.js';

/** Parse a 12-hour time string like "3:30pm" into a Date using `baseDate` for the date portion. */
function parseTime(timeStr: string, baseDate: Date): Date {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
  if (!match) throw new Error(`Cannot parse time: ${timeStr}`);

  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const isPm = match[3].toLowerCase() === 'pm';

  if (isPm && hours !== 12) hours += 12;
  if (!isPm && hours === 12) hours = 0;

  const date = new Date(baseDate);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

export function registerListSessionsTool(server: McpServer): void {
  server.tool(
    'list_sessions',
    'List upcoming Focusmate sessions from the dashboard.',
    {
      startDate: ListSessionsInput.shape.startDate,
      endDate: ListSessionsInput.shape.endDate
    },
    async ({ startDate, endDate }): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      // Check if authenticated
      if (!hasAuthData()) {
        const output: ListSessionsOutput = {
          sessions: [],
          totalCount: 0
        };
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ...output,
              error: 'Not authenticated. Please run focusmate_auth first.',
              errorCode: 'AUTH_REQUIRED'
            }, null, 2)
          }]
        };
      }

      const start = new Date(startDate);
      const end = endDate ? new Date(endDate) : new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

      let context;

      try {
        context = await launchPersistentContext({ headless: true });
        const page = context.pages()[0] || await context.newPage();

        await navigateToDashboard(page);

        const sessions = await withErrorScreenshot(page, 'list-sessions', async () => {
          // Wait for the dashboard to load
          await page.waitForTimeout(2000);

          // Session cards in the Upcoming panel have aria-label="Upcoming session"
          const sessionCards = page.getByLabel('Upcoming session');
          const count = await sessionCards.count();

          const sessions: Session[] = [];

          for (let i = 0; i < count; i++) {
            const card = sessionCards.nth(i);
            const cardText = await card.innerText() || '';

            // innerText gives newline-separated lines like:
            //   "5:30pm - 6:20pm\n50\n≋\nTrung V.\nJoin\n..."
            const timeMatch = cardText.match(/(\d{1,2}:\d{2}[ap]m)\s*-\s*(\d{1,2}:\d{2}[ap]m)/i);
            if (!timeMatch) continue;

            const durationMatch = cardText.match(/\b(25|50|75)\b/);
            const duration = durationMatch ? parseInt(durationMatch[1]) : 50;

            // Partner name: find lines that aren't times, durations, or button labels
            const lines = cardText.split('\n').map(l => l.trim()).filter(Boolean);
            const skipPatterns = /^(\d{1,2}:\d{2}[ap]m\s*-|25|50|75|Join|Clear|Starts in|≋|…|×|[.]{3})$/i;
            const nameLine = lines.find(l => !skipPatterns.test(l) && /[a-z]/i.test(l) && l.length > 1);
            const partnerName = nameLine || null;

            // Build ISO datetimes by parsing the 12-hour time strings
            const startDate = parseTime(timeMatch[1], start);
            const endDate = parseTime(timeMatch[2], start);
            // If end is before start, the session crosses midnight
            if (endDate <= startDate) {
              endDate.setDate(endDate.getDate() + 1);
            }

            sessions.push({
              id: `session-${i}`,
              startTime: startDate.toISOString(),
              endTime: endDate.toISOString(),
              duration,
              status: 'matched',
              partnerId: null,
              partnerName
            });
          }

          return sessions;
        });

        // Filter by date range if needed
        const filteredSessions = sessions.filter(s => {
          // Since we only have time strings, we can't fully filter by date
          // Return all sessions for now
          return true;
        });

        const output: ListSessionsOutput = {
          sessions: filteredSessions,
          totalCount: filteredSessions.length
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
        };

      } catch (error) {
        const output: ListSessionsOutput = {
          sessions: [],
          totalCount: 0
        };

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ...output,
              error: error instanceof Error ? error.message : 'Unknown error',
              errorCode: error instanceof AuthExpiredError ? 'AUTH_EXPIRED' : 'AUTOMATION_FAILED'
            }, null, 2)
          }]
        };

      } finally {
        if (context) {
          await context.close();
        }
      }
    }
  );
}
