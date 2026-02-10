export class FocusmateError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = 'FocusmateError';
  }
}

export class AuthExpiredError extends FocusmateError {
  constructor(message = 'Authentication expired. Please run focusmate_auth to log in again.') {
    super(message, 'AUTH_EXPIRED');
    this.name = 'AuthExpiredError';
  }
}

export class SlotUnavailableError extends FocusmateError {
  constructor(message = 'The requested time slot is not available.') {
    super(message, 'SLOT_UNAVAILABLE');
    this.name = 'SlotUnavailableError';
  }
}

export class SessionConflictError extends FocusmateError {
  constructor(message = 'You already have a session at this time.') {
    super(message, 'SESSION_CONFLICT');
    this.name = 'SessionConflictError';
  }
}

export class SessionNotFoundError extends FocusmateError {
  constructor(sessionId: string) {
    super(`Session ${sessionId} not found.`, 'SESSION_NOT_FOUND');
    this.name = 'SessionNotFoundError';
  }
}

export class AutomationFailedError extends FocusmateError {
  constructor(message: string, public screenshotPath?: string) {
    super(message, 'AUTOMATION_FAILED');
    this.name = 'AutomationFailedError';
  }
}
