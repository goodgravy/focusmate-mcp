import type { Page, Locator } from 'playwright';

export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;
  readonly googleSignInButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;

    // Email input
    this.emailInput = page.getByLabel(/email/i)
      .or(page.getByPlaceholder(/email/i))
      .or(page.locator('input[type="email"]'));

    // Password input
    this.passwordInput = page.getByLabel(/password/i)
      .or(page.getByPlaceholder(/password/i))
      .or(page.locator('input[type="password"]'));

    // Sign in button
    this.signInButton = page.getByRole('button', { name: /sign in/i })
      .or(page.getByRole('button', { name: /log in/i }))
      .or(page.locator('button[type="submit"]'));

    // Google OAuth button
    this.googleSignInButton = page.getByRole('button', { name: /google/i })
      .or(page.locator('button:has-text("Google")'));

    // Error message
    this.errorMessage = page.getByRole('alert')
      .or(page.locator('.error-message'))
      .or(page.getByText(/invalid/i));
  }

  async goto(): Promise<void> {
    await this.page.goto('https://app.focusmate.com/login');
    await this.page.waitForLoadState('networkidle');
  }

  async waitForLoginForm(): Promise<void> {
    // Wait for either email input or Google button to appear
    await this.emailInput.or(this.googleSignInButton).waitFor({ timeout: 10000 });
  }

  async isOnLoginPage(): Promise<boolean> {
    const url = this.page.url();
    return url.includes('/login') || url.includes('/signin');
  }
}
