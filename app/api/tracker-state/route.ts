import { env } from 'cloudflare:workers';
import { handleTrackerState, type TrackerApiConfig } from '../../../lib/tracker-api';

function getConfig(): TrackerApiConfig | null {
  const values = env as Record<string, string | undefined>;
  const read = (name: string) => String(values[name] || process.env[name] || '').trim();
  const config = {
    supabaseUrl: read('SUPABASE_URL').replace(/\/$/, ''),
    serviceRoleKey: read('SUPABASE_SERVICE_ROLE_KEY'),
    ownerId: read('SUPABASE_TRACKER_OWNER_ID'),
    accessPassword: read('TRACKER_ACCESS_PASSWORD'),
    sessionSecret: read('TRACKER_SESSION_SECRET'),
  };
  return Object.values(config).every(Boolean) ? config : null;
}

export async function GET(request: Request) {
  return handleTrackerState(request, getConfig());
}

export async function PUT(request: Request) {
  return handleTrackerState(request, getConfig());
}
