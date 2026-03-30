import * as fs from 'fs';
import * as path from 'path';
import { getConfigDir } from '../automation/config.js';

const CONFIG_FILE = 'config.json';

interface Config {
  apiKey?: string;
}

function loadConfig(): Config {
  const configPath = path.join(getConfigDir(), CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as Config;
  } catch {
    return {};
  }
}

export function getApiKey(): string | undefined {
  return loadConfig().apiKey;
}
