import type { Page, Locator } from 'playwright';

export class DashboardPage {
  readonly page: Page;
  readonly bookButton: Locator;
  readonly scheduleButton: Locator;
  readonly upcomingSessions: Locator;
  readonly sessionList: Locator;

  constructor(page: Page) {
    this.page = page;
    // These selectors may need refinement based on actual FocusMate UI
    this.bookButton = page.getByRole('button', { name: /book/i });
    this.scheduleButton = page.getByRole('button', { name: /schedule/i });
    this.upcomingSessions = page.locator('[data-testid="upcoming-sessions"]')
      .or(page.getByRole('region', { name: /upcoming/i }))
      .or(page.locator('.upcoming-sessions'));
    this.sessionList = page.getByRole('list').filter({ hasText: /session/i });
  }

  async goto(): Promise<void> {
    await this.page.goto('https://app.focusmate.com/dashboard');
    // Wait for the page to be interactive
    await this.page.waitForLoadState('networkidle');
  }

  async waitForLoad(): Promise<void> {
    // Wait for key elements to be visible
    await this.bookButton.or(this.scheduleButton).waitFor({ timeout: 10000 });
  }

  async getUpcomingSessionElements(): Promise<Locator[]> {
    // Try to find session cards in the upcoming section
    const sessions = this.page.locator('[data-testid="session-card"]')
      .or(this.page.locator('.session-card'))
      .or(this.upcomingSessions.getByRole('listitem'));

    const count = await sessions.count();
    const elements: Locator[] = [];
    for (let i = 0; i < count; i++) {
      elements.push(sessions.nth(i));
    }
    return elements;
  }

  async clickBookSession(): Promise<void> {
    await this.bookButton.click();
  }

  async clickSchedule(): Promise<void> {
    await this.scheduleButton.click();
  }
}
