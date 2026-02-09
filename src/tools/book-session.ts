import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  launchPersistentContext,
  hasAuthData,
  navigateToDashboard,
  withErrorScreenshot
} from '../automation/browser.js';
import { BookingPage } from '../automation/pages/booking.js';
import {
  BookSessionInput,
  type BookSessionOutput,
  type Session,
  type SessionDuration
} from '../schemas/session.js';
import {
  SlotUnavailableError,
  SessionConflictError,
  InvalidTimeError,
  AuthExpiredError
} from '../utils/errors.js';

export function registerBookSessionTool(server: McpServer): void {
  server.tool(
    'book_session',
    'Book a FocusMate accountability session for a specific date, time, and duration.',
    {
      startTime: BookSessionInput.shape.startTime,
      duration: BookSessionInput.shape.duration
    },
    async ({ startTime, duration }): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const targetDate = new Date(startTime);

      // Validate the time is in the future
      if (targetDate <= new Date()) {
        const output: BookSessionOutput = {
          success: false,
          error: 'Cannot book sessions in the past.',
          errorCode: 'INVALID_TIME'
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
        };
      }

      // Validate time is on a 15-minute boundary
      const minutes = targetDate.getMinutes();
      if (minutes % 15 !== 0) {
        const output: BookSessionOutput = {
          success: false,
          error: `Invalid time. FocusMate sessions start every 15 minutes. Please choose a time like ${targetDate.getHours()}:00, ${targetDate.getHours()}:15, ${targetDate.getHours()}:30, or ${targetDate.getHours()}:45.`,
          errorCode: 'INVALID_TIME'
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
        };
      }

      // Check if authenticated
      if (!hasAuthData()) {
        const output: BookSessionOutput = {
          success: false,
          error: 'Not authenticated. Please run focusmate_auth first.',
          errorCode: 'AUTH_REQUIRED'
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
        };
      }

      let context;

      try {
        // Use persistent context which preserves Firebase auth tokens in IndexedDB
        context = await launchPersistentContext({ headless: true });
        const page = context.pages()[0] || await context.newPage();

        // Navigate to dashboard
        await navigateToDashboard(page);

        const result = await withErrorScreenshot(page, 'book-session', async () => {
          const bookingPage = new BookingPage(page);

          // Select duration
          await bookingPage.selectDuration(duration as SessionDuration);

          // Select the time slot
          await bookingPage.selectTimeSlot(targetDate);

          // Check for conflicts or unavailability
          if (await bookingPage.hasConflict()) {
            throw new SessionConflictError();
          }

          if (!await bookingPage.isSlotAvailable()) {
            throw new SlotUnavailableError();
          }

          // Confirm the booking
          await bookingPage.confirmBooking();

          // Get confirmation details
          const { sessionId } = await bookingPage.getConfirmationDetails();

          // Calculate end time based on duration
          const endTime = new Date(targetDate);
          endTime.setMinutes(endTime.getMinutes() + parseInt(duration));

          const session: Session = {
            id: sessionId || `temp-${Date.now()}`,
            startTime: targetDate.toISOString(),
            endTime: endTime.toISOString(),
            duration: parseInt(duration),
            status: 'pending',
            partnerId: null,
            partnerName: null
          };

          return session;
        });

        const output: BookSessionOutput = {
          success: true,
          session: result
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
        };

      } catch (error) {
        const output: BookSessionOutput = {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred',
          errorCode: error instanceof SlotUnavailableError ? 'SLOT_UNAVAILABLE'
            : error instanceof SessionConflictError ? 'SESSION_CONFLICT'
            : error instanceof InvalidTimeError ? 'INVALID_TIME'
            : error instanceof AuthExpiredError ? 'AUTH_EXPIRED'
            : 'AUTOMATION_FAILED'
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
        };

      } finally {
        if (context) {
          await context.close();
        }
      }
    }
  );
}
