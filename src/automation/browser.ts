import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { loadStorageState, hasCookies, getConfigDir } from './cookies.js';
import { AuthExpiredError, AutomationFailedError } from '../utils/errors.js';

const FOCUSMATE_BASE_URL = 'https://www.focusmate.com';
const LOGIN_URL = `${FOCUSMATE_BASE_URL}/login`;
const DASHBOARD_URL = `${FOCUSMATE_BASE_URL}/dashboard`;

let browserInstance: Browser | null = null;

export interface BrowserOptions {
  headless?: boolean;
  slowMo?: number;
}

export async function launchBrowser(options: BrowserOptions = {}): Promise<Browser> {
  const { headless = true, slowMo = 0 } = options;

  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  browserInstance = await chromium.launch({
    headless,
    slowMo
  });

  return browserInstance;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

export async function createAuthenticatedContext(browser: Browser): Promise<BrowserContext> {
  const storagePath = loadStorageState();

  if (!storagePath) {
    throw new AuthExpiredError('No stored credentials found. Please run focusmate_auth first.');
  }

  const context = await browser.newContext({
    storageState: storagePath
  });

  return context;
}

export async function createFreshContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext();
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();

  // If we're on the login page, we're not logged in
  if (url.includes('/login')) {
    return false;
  }

  // Check for dashboard-specific elements
  try {
    // Look for elements that only appear when logged in
    const loggedInIndicator = page.getByRole('button', { name: /book/i });
    await loggedInIndicator.waitFor({ timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function checkAuthAndNavigate(page: Page, targetUrl: string): Promise<void> {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  // Give the page time to redirect if auth is invalid
  await page.waitForTimeout(1000);

  const currentUrl = page.url();

  // If we were redirected to login, auth has expired
  if (currentUrl.includes('/login')) {
    throw new AuthExpiredError('Session expired. Please run focusmate_auth to log in again.');
  }
}

export async function navigateToDashboard(page: Page): Promise<void> {
  await checkAuthAndNavigate(page, DASHBOARD_URL);
}

export function getScreenshotDir(): string {
  const screenshotDir = path.join(getConfigDir(), 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
  return screenshotDir;
}

export async function captureScreenshotOnError(
  page: Page,
  operationName: string
): Promise<string> {
  const screenshotDir = getScreenshotDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${operationName}-error-${timestamp}.png`;
  const screenshotPath = path.join(screenshotDir, filename);

  await page.screenshot({
    path: screenshotPath,
    fullPage: true
  });

  return screenshotPath;
}

export async function withErrorScreenshot<T>(
  page: Page,
  operationName: string,
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const screenshotPath = await captureScreenshotOnError(page, operationName);

    if (error instanceof AuthExpiredError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new AutomationFailedError(
      `${operationName} failed: ${message}. Screenshot saved to ${screenshotPath}`,
      screenshotPath
    );
  }
}

export { FOCUSMATE_BASE_URL, LOGIN_URL, DASHBOARD_URL };
