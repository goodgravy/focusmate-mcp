import type { Page, Locator, Request, Response } from 'playwright';
import type { SessionDuration } from '../../schemas/session.js';

interface CapturedBookingRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  responseStatus?: number;
  responseBody?: string;
}

export class BookingPage {
  readonly page: Page;

  // Duration selection buttons
  readonly duration25Button: Locator;
  readonly duration50Button: Locator;
  readonly duration75Button: Locator;

  // The "Book" button that appears in-slot after clicking an empty calendar cell
  readonly confirmBookingButton: Locator;

  // Captured API calls during booking
  private capturedRequests: CapturedBookingRequest[] = [];

  constructor(page: Page) {
    this.page = page;

    // Duration buttons - match exact label text "25 min", "50 min", "75 min"
    this.duration25Button = page.getByRole('button', { name: '25 min', exact: true });
    this.duration50Button = page.getByRole('button', { name: '50 min', exact: true });
    this.duration75Button = page.getByRole('button', { name: '75 min', exact: true });

    // The "Book N session(s)" button in the bottom bar after selecting slots
    this.confirmBookingButton = page.getByRole('button', { name: /^Book \d+ session/i })
      .or(page.getByRole('button', { name: 'Book', exact: true }));
  }

  /** Start capturing API requests to understand the booking flow. */
  async startRequestCapture(): Promise<void> {
    this.capturedRequests = [];

    this.page.on('request', (request: Request) => {
      const url = request.url();
      const method = request.method();
      // Capture mutations and API calls
      if (method !== 'GET' || url.includes('api.focusmate.com') || url.includes('/api/')) {
        this.capturedRequests.push({
          url,
          method,
          headers: request.headers(),
          body: request.postData() || null
        });
      }
    });

    this.page.on('response', async (response: Response) => {
      const url = response.url();
      const captured = this.capturedRequests.find(r => r.url === url && !r.responseStatus);
      if (captured) {
        captured.responseStatus = response.status();
        try {
          captured.responseBody = await response.text();
        } catch {
          // Response body not available
        }
      }
    });
  }

  getCapturedRequests(): CapturedBookingRequest[] {
    return this.capturedRequests;
  }

  async selectDuration(duration: SessionDuration): Promise<void> {
    const button = duration === '25' ? this.duration25Button
      : duration === '75' ? this.duration75Button
      : this.duration50Button;

    await button.waitFor({ timeout: 10000 });
    await button.click();
    // Wait for the calendar grid to update after duration change
    await this.page.waitForLoadState('networkidle');
  }

  async selectTimeSlot(targetDate: Date): Promise<void> {
    await this.navigateToDate(targetDate);

    const hours = targetDate.getHours();
    const minutes = targetDate.getMinutes();

    // Format for 12-hour display
    const hour12 = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
    const ampm = hours >= 12 ? 'pm' : 'am';

    // Strategy: Find the time slot cell using the grid structure
    // Focusmate's calendar is a grid. We need to:
    // 1. Find the correct row (time)
    // 2. Find the correct column (day)
    // 3. Click the intersection

    // First, scroll the target time into view
    const hourLabel = `${hour12}${ampm}`;
    await this.scrollToTime(hourLabel);

    // Calculate the sub-hour offset for 15-min slots
    const slotIndex = minutes / 15; // 0, 1, 2, or 3

    // Strategy 1: Try to find clickable slot cells directly
    // Focusmate renders empty slots as clickable cells in the grid
    const clicked = await this.tryClickSlotByGridPosition(targetDate, hourLabel, slotIndex);

    if (!clicked) {
      // Strategy 2: Coordinate-based clicking with improved measurement
      await this.clickSlotByCoordinates(targetDate, hourLabel, slotIndex);
    }

    // Wait for the "Book" button to appear (indicates slot was selected)
    try {
      await this.confirmBookingButton.waitFor({ timeout: 5000 });
    } catch {
      // Take a diagnostic screenshot
      throw new Error(
        `Failed to select time slot for ${hourLabel}:${minutes.toString().padStart(2, '0')}. ` +
        `The "Book" button did not appear after clicking.`
      );
    }
  }

  private async scrollToTime(hourLabel: string): Promise<void> {
    // Scroll the calendar to bring the target hour into view
    // Use string-based evaluate to avoid transpilation issues with page.evaluate
    await this.page.evaluate(`
      (function(label) {
        var walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          { acceptNode: function(node) {
            return node.textContent && node.textContent.trim() === label
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_REJECT;
          }}
        );
        var node = walker.nextNode();
        if (node && node.parentElement) {
          node.parentElement.scrollIntoView({ behavior: 'instant', block: 'center' });
        }
      })("${hourLabel}")
    `);

    // Brief pause for scroll to settle
    await this.page.locator(`text="${hourLabel}"`).first().waitFor({ timeout: 3000 });
  }

  private async tryClickSlotByGridPosition(
    targetDate: Date,
    hourLabel: string,
    slotIndex: number
  ): Promise<boolean> {
    const dayOfMonth = targetDate.getDate();
    const dayName = targetDate.toLocaleDateString('en-US', { weekday: 'short' });

    // Try to find the column index from headers
    // Look for column headers like "Mon 30", "Tue 31", etc.
    const headerText = `${dayName} ${dayOfMonth}`;

    try {
      // Find all column headers to determine column position
      const headers = this.page.locator('[class*="header"], [class*="Header"], th, [role="columnheader"]');
      const headerCount = await headers.count();

      let targetColIndex = -1;
      for (let i = 0; i < headerCount; i++) {
        const text = await headers.nth(i).textContent();
        if (text?.includes(String(dayOfMonth)) && text?.includes(dayName)) {
          targetColIndex = i;
          break;
        }
      }

      if (targetColIndex === -1) {
        // Try a more flexible header search
        const allHeaders = this.page.locator('text=/\\w{3}\\s+\\d{1,2}/');
        const allHeaderCount = await allHeaders.count();
        for (let i = 0; i < allHeaderCount; i++) {
          const text = await allHeaders.nth(i).textContent();
          if (text?.includes(String(dayOfMonth))) {
            targetColIndex = i;
            break;
          }
        }
      }

      // Try to find clickable empty cells in the grid near the time row
      // Look for cells/buttons that represent available time slots
      const slotCells = this.page.locator(
        '[class*="slot"], [class*="cell"], [class*="available"], [data-time], [role="gridcell"]'
      );

      const cellCount = await slotCells.count();
      if (cellCount === 0) return false;

      // Look for a cell near our target time
      const targetMinutes = targetDate.getHours() * 60 + targetDate.getMinutes();

      for (let i = 0; i < cellCount; i++) {
        const cell = slotCells.nth(i);
        const timeAttr = await cell.getAttribute('data-time');
        if (timeAttr) {
          // If cells have data-time attributes, use them directly
          const cellTime = new Date(timeAttr);
          const cellMinutes = cellTime.getHours() * 60 + cellTime.getMinutes();
          if (cellMinutes === targetMinutes) {
            await cell.click();
            return true;
          }
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  private async clickSlotByCoordinates(
    targetDate: Date,
    hourLabel: string,
    slotIndex: number
  ): Promise<void> {
    const dayOfMonth = targetDate.getDate();
    const dayName = targetDate.toLocaleDateString('en-US', { weekday: 'short' });

    // Find the hour label element
    const timeLabel = this.page.locator(`text="${hourLabel}"`).first();
    await timeLabel.waitFor({ timeout: 5000 });
    const labelBox = await timeLabel.boundingBox();
    if (!labelBox) {
      throw new Error(`Could not locate time label "${hourLabel}" on page`);
    }

    // Find the next hour label to measure pixels-per-hour
    const hours = targetDate.getHours();
    let pixelsPerHour = 192; // Default based on observed UI

    // Try next hour, then previous hour for measurement
    for (const offset of [1, -1]) {
      const refHour = (hours + offset + 24) % 24;
      const refHour12 = refHour > 12 ? refHour - 12 : (refHour === 0 ? 12 : refHour);
      const refAmpm = refHour >= 12 ? 'pm' : 'am';
      const refLabel = `${refHour12}${refAmpm}`;

      try {
        const refBox = await this.page.locator(`text="${refLabel}"`).first().boundingBox();
        if (refBox) {
          pixelsPerHour = Math.abs(refBox.y - labelBox.y);
          break;
        }
      } catch {
        continue;
      }
    }

    // Find column header for the target day
    const headerLocator = this.page.locator(`text="${dayName} ${dayOfMonth}"`).first();
    let clickX: number;

    try {
      const headerBox = await headerLocator.boundingBox();
      if (headerBox) {
        clickX = headerBox.x + headerBox.width / 2;
      } else {
        // Fallback: try alternative header format
        const altHeader = this.page.locator(`text=/${dayName}.*${dayOfMonth}/`).first();
        const altBox = await altHeader.boundingBox();
        if (altBox) {
          clickX = altBox.x + altBox.width / 2;
        } else {
          throw new Error(`Could not find column header for ${dayName} ${dayOfMonth}`);
        }
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('Could not find')) throw e;
      throw new Error(`Could not find column header for ${dayName} ${dayOfMonth}`);
    }

    // Calculate Y position: hour label + sub-hour offset
    const minuteOffset = (slotIndex * 15 / 60) * pixelsPerHour;
    const clickY = labelBox.y + minuteOffset + (pixelsPerHour / 8); // Small offset into the cell

    await this.page.mouse.click(clickX, clickY);
    // Wait for slot selection UI to react
    await this.page.waitForTimeout(600);
  }

  private async navigateToDate(targetDate: Date): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(targetDate);
    target.setHours(0, 0, 0, 0);

    const daysDiff = Math.floor((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff < 0) {
      throw new Error('Cannot book sessions in the past');
    }

    const dayOfMonth = targetDate.getDate();
    const dayName = targetDate.toLocaleDateString('en-US', { weekday: 'short' });
    const headerText = `${dayName} ${dayOfMonth}`;

    // Check if target date is already visible
    const dayHeader = this.page.locator(`text="${headerText}"`).first();
    const isVisible = await dayHeader.isVisible().catch(() => false);

    if (isVisible) return;

    // Navigate forward using the "Go forward one day" button
    const nextButton = this.page.getByRole('button', { name: 'Go forward one day' });

    for (let i = 0; i < 14; i++) {
      await nextButton.click();
      // Wait for the grid to update — check if target header appeared
      try {
        await this.page.locator(`text="${headerText}"`).first().waitFor({ timeout: 2000 });
        return;
      } catch {
        // Not visible yet, keep navigating
      }
    }

    throw new Error(`Could not navigate to date ${headerText}`);
  }

  async confirmBooking(): Promise<void> {
    // The "Book N session" button appears in the bottom bar after slot selection
    const isVisible = await this.confirmBookingButton.isVisible().catch(() => false);
    if (!isVisible) {
      throw new Error('"Book" button not visible — slot selection may have failed');
    }

    await this.confirmBookingButton.click();

    // Wait for the booking to be processed (button disappears)
    await this.confirmBookingButton.waitFor({ state: 'hidden', timeout: 15000 });
  }

  async getConfirmationDetails(): Promise<{ sessionId?: string }> {
    // Try to extract session ID from captured API requests
    for (const req of this.capturedRequests) {
      if (req.responseBody) {
        try {
          const body = JSON.parse(req.responseBody);
          if (body.sessionId) return { sessionId: body.sessionId };
          if (body.session?.sessionId) return { sessionId: body.session.sessionId };
          if (body.id) return { sessionId: body.id };
        } catch {
          // Not JSON
        }
      }
    }

    // Fallback: look for session link on the page
    const sessionLink = this.page.locator('a[href*="/session/"]');
    try {
      const href = await sessionLink.first().getAttribute('href', { timeout: 3000 });
      if (href) {
        const match = href.match(/\/session\/([^/?]+)/);
        if (match) return { sessionId: match[1] };
      }
    } catch {
      // No link found
    }

    return {};
  }

  async isSlotAvailable(): Promise<boolean> {
    const unavailableIndicator = this.page.getByText(/not available/i)
      .or(this.page.getByText(/fully booked/i));

    try {
      await unavailableIndicator.waitFor({ timeout: 1000 });
      return false;
    } catch {
      return true;
    }
  }

  async hasConflict(): Promise<boolean> {
    const conflictIndicator = this.page.getByText(/already have a session/i)
      .or(this.page.getByText(/conflict/i));

    try {
      await conflictIndicator.waitFor({ timeout: 1000 });
      return true;
    } catch {
      return false;
    }
  }
}
