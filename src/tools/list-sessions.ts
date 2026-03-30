import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { FocusmateClient } from '../api/focusmate-client.js';
import { getApiKey } from '../api/config.js';
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

async function listViaApi(startDate: string, endDate: string): Promise<Session[]> {
  const client = new FocusmateClient();
  return client.getSessions(startDate, endDate);
}

async function listViaBrowser(start: Date, end: Date): Promise<Session[]> {
  if (!hasAuthData()) {
    throw new Error('Not authenticated. Please run focusmate_auth first.');
  }

  const context = await launchPersistentContext({ headless: true });
  try {
    const page = context.pages()[0] || await context.newPage();
    await navigateToDashboard(page);

    return await withErrorScreenshot(page, 'list-sessions', async () => {
      await page.waitForTimeout(2000);

      const sessionCards = page.getByLabel('Upcoming session');
      const count = await sessionCards.count();
      const sessions: Session[] = [];

      for (let i = 0; i < count; i++) {
        const card = sessionCards.nth(i);
        const cardText = await card.innerText() || '';

        const timeMatch = cardText.match(/(\d{1,2}:\d{2}[ap]m)\s*-\s*(\d{1,2}:\d{2}[ap]m)/i);
        if (!timeMatch) continue;

        const durationMatch = cardText.match(/\b(25|50|75)\b/);
        const duration = durationMatch ? parseInt(durationMatch[1]) : 50;

        const lines = cardText.split('\n').map(l => l.trim()).filter(Boolean);
        const skipPatterns = /^(\d{1,2}:\d{2}[ap]m\s*-|25|50|75|Join|Clear|Starts in|≋|…|×|[.]{3})$/i;
        const nameLine = lines.find(l => !skipPatterns.test(l) && /[a-z]/i.test(l) && l.length > 1);
        const partnerName = nameLine || null;

        const startDate = parseTime(timeMatch[1], start);
        const endDate = parseTime(timeMatch[2], start);
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
  } finally {
    await context.close();
  }
}

export function registerListSessionsTool(server: McpServer): void {
  server.tool(
    'list_sessions',
    'List upcoming Focusmate sessions. Uses the API if an API key is configured, otherwise falls back to browser scraping.',
    {
      startDate: ListSessionsInput.shape.startDate,
      endDate: ListSessionsInput.shape.endDate
    },
    async ({ startDate, endDate }): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const start = new Date(startDate);
      const end = endDate ? new Date(endDate) : new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

      try {
        // Prefer API if key is configured
        if (getApiKey()) {
          const sessions = await listViaApi(start.toISOString(), end.toISOString());
          const output: ListSessionsOutput = {
            sessions,
            totalCount: sessions.length
          };
          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
          };
        }
      } catch (error) {
        // API failed, fall through to browser
        console.error('API listing failed, falling back to browser:', error);
      }

      // Browser fallback
      try {
        if (!hasAuthData()) {
          const output: ListSessionsOutput = { sessions: [], totalCount: 0 };
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

        const sessions = await listViaBrowser(start, end);
        const output: ListSessionsOutput = {
          sessions,
          totalCount: sessions.length
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
        };
      } catch (error) {
        const output: ListSessionsOutput = { sessions: [], totalCount: 0 };
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
      }
    }
  );
}
