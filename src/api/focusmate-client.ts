import { getApiKey } from '../automation/config.js';
import { ApiError, ConfigError } from '../utils/errors.js';
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
      throw new ConfigError(
        'FocusMate API key not configured. ' +
        'Please generate an API key at https://www.focusmate.com/profile/edit-p ' +
        'and store it in ~/.focusmate-mcp/config.json as {"apiKey": "your-key"}'
      );
    }
    this.apiKey = key;
  }

  private async request<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${API_BASE_URL}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
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
        throw new ApiError('Invalid API key. Please check your FocusMate API key.', 401);
      }
      if (response.status === 429) {
        throw new ApiError('Rate limit exceeded. Please wait before making more requests.', 429);
      }
      throw new ApiError(`API request failed: ${response.statusText}`, response.status);
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

    // Find the current user and partner
    const currentUser = apiSession.users[0];
    const partner = apiSession.users[1];

    // Determine status based on session state
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
      partnerName: null, // API doesn't return partner name, would need separate call
      title: currentUser?.sessionTitle
    };
  }

  async getPartnerProfile(userId: string): Promise<{ name: string }> {
    const response = await this.request<ApiProfileResponse>(`/users/${userId}`);
    return { name: response.user.name };
  }

  async enrichSessionsWithPartnerNames(sessions: Session[]): Promise<Session[]> {
    const enrichedSessions = await Promise.all(
      sessions.map(async (session) => {
        if (session.partnerId) {
          try {
            const partner = await this.getPartnerProfile(session.partnerId);
            return { ...session, partnerName: partner.name };
          } catch {
            // If we can't get partner info, just return session without name
            return session;
          }
        }
        return session;
      })
    );
    return enrichedSessions;
  }
}
