import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { BrowserContext } from 'playwright';

const CONFIG_DIR = path.join(os.homedir(), '.focusmate-mcp');
const COOKIES_FILE = path.join(CONFIG_DIR, 'cookies.json');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface Config {
  apiKey?: string;
}

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function hasCookies(): boolean {
  return fs.existsSync(COOKIES_FILE);
}

export function getCookiesPath(): string {
  return COOKIES_FILE;
}

export async function saveCookies(context: BrowserContext): Promise<void> {
  ensureConfigDir();
  const storageState = await context.storageState();
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(storageState, null, 2), { mode: 0o600 });
}

export function loadStorageState(): string | undefined {
  if (!hasCookies()) {
    return undefined;
  }
  return COOKIES_FILE;
}

export function deleteCookies(): void {
  if (fs.existsSync(COOKIES_FILE)) {
    fs.unlinkSync(COOKIES_FILE);
  }
}

export function getCookiesAge(): number | null {
  if (!hasCookies()) {
    return null;
  }
  const stats = fs.statSync(COOKIES_FILE);
  return Date.now() - stats.mtimeMs;
}

export function areCookiesFresh(maxAgeMs: number = 12 * 60 * 60 * 1000): boolean {
  const age = getCookiesAge();
  if (age === null) {
    return false;
  }
  return age < maxAgeMs;
}

export function loadConfig(): Config {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    return {};
  }
  try {
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(content) as Config;
  } catch {
    return {};
  }
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function getApiKey(): string | undefined {
  return loadConfig().apiKey;
}

export function setApiKey(apiKey: string): void {
  const config = loadConfig();
  config.apiKey = apiKey;
  saveConfig(config);
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}
