import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { FocusmateClient } from '../api/focusmate-client.js';
import {
  ListSessionsInput,
  type ListSessionsOutput
} from '../schemas/session.js';
import { ConfigError, ApiError } from '../utils/errors.js';

export function registerListSessionsTool(server: McpServer): void {
  server.tool(
    'list_sessions',
    'List FocusMate sessions within a date range. Requires API key to be configured.',
    {
      startDate: ListSessionsInput.shape.startDate,
      endDate: ListSessionsInput.shape.endDate
    },
    async ({ startDate, endDate }): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      // Calculate default end date if not provided (7 days from start)
      const start = new Date(startDate);
      let end: Date;

      if (endDate) {
        end = new Date(endDate);
      } else {
        end = new Date(start);
        end.setDate(end.getDate() + 7);
      }

      // Validate date range
      if (end < start) {
        const output: ListSessionsOutput = {
          sessions: [],
          totalCount: 0
        };
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ...output,
              error: 'End date must be after start date',
              errorCode: 'INVALID_DATE_RANGE'
            }, null, 2)
          }]
        };
      }

      try {
        const client = new FocusmateClient();

        // Fetch sessions
        let sessions = await client.getSessions(
          start.toISOString(),
          end.toISOString()
        );

        // Optionally enrich with partner names (can be slow with many sessions)
        // Only do this for smaller result sets
        if (sessions.length <= 20) {
          sessions = await client.enrichSessionsWithPartnerNames(sessions);
        }

        const output: ListSessionsOutput = {
          sessions,
          totalCount: sessions.length
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
        };

      } catch (error) {
        if (error instanceof ConfigError) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                sessions: [],
                totalCount: 0,
                error: error.message,
                errorCode: 'CONFIG_ERROR'
              }, null, 2)
            }]
          };
        }

        if (error instanceof ApiError) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                sessions: [],
                totalCount: 0,
                error: error.message,
                errorCode: 'API_ERROR'
              }, null, 2)
            }]
          };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              sessions: [],
              totalCount: 0,
              error: error instanceof Error ? error.message : 'Unknown error',
              errorCode: 'UNKNOWN_ERROR'
            }, null, 2)
          }]
        };
      }
    }
  );
}
