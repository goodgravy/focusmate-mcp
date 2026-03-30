import { getApiKey } from './config.js';
import type { Session, SessionStatus } from '../schemas/session.js';

const API_BASE_URL = 'https://api.focusmate.com/v1';

interface ApiSession {
  sessionId: string;
  duration: number; // milliseconds
  startTime: string; // ISO 8601 UTC
  users: Array<{
    userId: string;
    requestedAt: string;
    joinedAt?: string;
    completed: boolean;
    sessionTitle?: string;
  }>;
}

interface ApiSessionsResponse {
  sessions: ApiSession[];
}

interface ApiProfileResponse {
  user: {
    userId: string;
    name: string;
    totalSessionCount: number;
    timeZone: string;
    photoUrl?: string;
  };
}

export class FocusmateClient {
  private apiKey: string;

  constructor(apiKey?: string) {
    const key = apiKey || getApiKey();
    if (!key) {
      throw new Error(
        'Focusmate API key not configured. ' +
        'Generate one at https://www.focusmate.com/profile/edit-p ' +
        'and store it in ~/.focusmate-mcp/config.json as {"apiKey": "your-key"}'
      );
    }
    this.apiKey = key;
  }

  private async request<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${API_BASE_URL}${endpoint}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.append(key, value);
      }
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid Focusmate API key. Check ~/.focusmate-mcp/config.json');
      }
      if (response.status === 429) {
        throw new Error('Focusmate API rate limit exceeded. Wait before retrying.');
      }
      throw new Error(`Focusmate API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async getProfile(): Promise<ApiProfileResponse> {
    return this.request<ApiProfileResponse>('/me');
  }

  async getSessions(startDate: string, endDate: string): Promise<Session[]> {
    const response = await this.request<ApiSessionsResponse>('/sessions', {
      start: startDate,
      end: endDate
    });

    return response.sessions.map(session => this.mapApiSession(session));
  }

  private mapApiSession(apiSession: ApiSession): Session {
    const durationMinutes = Math.round(apiSession.duration / 60000);
    const startTime = new Date(apiSession.startTime);
    const endTime = new Date(startTime.getTime() + apiSession.duration);

    const currentUser = apiSession.users[0];
    const partner = apiSession.users[1];

    let status: SessionStatus = 'pending';
    const now = new Date();

    if (startTime > now) {
      status = partner ? 'matched' : 'pending';
    } else if (endTime > now) {
      status = 'in_progress';
    } else {
      status = currentUser?.completed ? 'completed' : 'no_show';
    }

    return {
      id: apiSession.sessionId,
      startTime: apiSession.startTime,
      endTime: endTime.toISOString(),
      duration: durationMinutes,
      status,
      partnerId: partner?.userId ?? null,
      partnerName: null,
      title: currentUser?.sessionTitle
    };
  }
}
