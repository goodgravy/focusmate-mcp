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
          // Wait for the Upcoming section to load
          await page.waitForTimeout(2000);

          // Find all session entries in the Upcoming panel
          // The panel shows sessions grouped by date with session cards
          const sessionCards = page.locator('[class*="upcoming"] [class*="session"]')
            .or(page.getByLabel('Upcoming session'))
            .or(page.locator('text=/\\d+:\\d+[ap]m\\s*-\\s*\\d+:\\d+[ap]m/i').locator('..').locator('..'));

          const sessions: Session[] = [];
          const count = await sessionCards.count();

          for (let i = 0; i < count; i++) {
            const card = sessionCards.nth(i);
            const cardText = await card.textContent() || '';

            // Try to extract session details from the card
            // Format: "9:00am - 9:50am" "50" "Partner Name" "Join"
            const timeMatch = cardText.match(/(\d{1,2}:\d{2}[ap]m)\s*-\s*(\d{1,2}:\d{2}[ap]m)/i);
            const durationMatch = cardText.match(/\b(25|50|75)\b/);

            if (timeMatch) {
              // Parse the date from context (look for date headers like "Tomorrow, February 5")
              // For now, assume sessions are upcoming
              const startTimeStr = timeMatch[1];
              const endTimeStr = timeMatch[2];
              const duration = durationMatch ? parseInt(durationMatch[1]) : 50;

              // Extract partner name - typically after the time and duration
              const partnerMatch = cardText.match(/(?:25|50|75)[^\w]*([^J]+?)(?:Join|$)/i);
              const partnerName = partnerMatch ? partnerMatch[1].trim() : null;

              // Try to find session ID from any links
              const sessionLink = card.locator('a[href*="/session/"]');
              let sessionId: string | undefined;
              try {
                const href = await sessionLink.first().getAttribute('href', { timeout: 500 });
                const idMatch = href?.match(/\/session\/([^/?]+)/);
                if (idMatch) sessionId = idMatch[1];
              } catch {
                // No session link found
              }

              sessions.push({
                id: sessionId || `unknown-${i}`,
                startTime: startTimeStr,
                endTime: endTimeStr,
                duration,
                status: 'matched',
                partnerId: null,
                partnerName: partnerName || null
              });
            }
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
