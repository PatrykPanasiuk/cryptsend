const DEFAULT_TTL = 86400;
const MAX_TTL = 604800;
const MAX_BODY_SIZE = 10240;
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 20;

const rateLimitStore = new Map();

function rateLimit(ip) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, []);
  }
  const timestamps = rateLimitStore.get(ip).filter((t) => t > windowStart);
  if (timestamps.length >= RATE_LIMIT_MAX) return false;
  timestamps.push(now);
  rateLimitStore.set(ip, timestamps);
  return true;
}

function generateId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getRedis() {
  const url = process.env.KV_URL
    || process.env.REDIS_URL
    || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN
    || process.env.REDIS_TOKEN
    || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  const { Redis } = await import('@upstash/redis');
  return new Redis({ url, token });
}

function clientIp(request) {
  return request.headers.get('x-forwarded-for')
    || request.headers.get('x-real-ip')
    || 'unknown';
}

export async function GET(request) {
  const ip = clientIp(request);
  if (!rateLimit(ip)) {
    return new Response(
      JSON.stringify({ error: 'Too many requests. Try again later.' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '60',
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  const redis = await getRedis();
  if (!redis) {
    return new Response(
      JSON.stringify({ error: 'Server-side storage is not configured.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id || !/^[a-f0-9]{32}$/.test(id)) {
    return new Response(
      JSON.stringify({ error: 'Missing or invalid parameter: id.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const key = `secret:${id}`;
  const encrypted = await redis.get(key);

  if (!encrypted) {
    return new Response(
      JSON.stringify({ error: 'Secret not found or already viewed.' }),
      {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  }

  await redis.del(key);

  return new Response(
    JSON.stringify({ encrypted }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}

export async function POST(request) {
  const ip = clientIp(request);
  if (!rateLimit(ip)) {
    return new Response(
      JSON.stringify({ error: 'Too many requests. Try again later.' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '60',
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  const redis = await getRedis();
  if (!redis) {
    return new Response(
      JSON.stringify({
        error: 'Server-side storage is not configured. '
          + 'Set KV_URL (or REDIS_URL / UPSTASH_REDIS_REST_URL) and '
          + 'KV_REST_API_TOKEN (or REDIS_TOKEN / UPSTASH_REDIS_REST_TOKEN) '
          + 'environment variables.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { encrypted } = body;

  if (!encrypted || typeof encrypted !== 'string' || encrypted.length === 0) {
    return new Response(
      JSON.stringify({ error: 'Missing or invalid field: encrypted (must be a non-empty string).' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (encrypted.length > MAX_BODY_SIZE) {
    return new Response(
      JSON.stringify({ error: `Encrypted payload exceeds ${MAX_BODY_SIZE} characters.` }),
      { status: 413, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let ttl = DEFAULT_TTL;
  if (body.ttl && typeof body.ttl === 'number' && Number.isFinite(body.ttl)) {
    ttl = Math.min(Math.max(60, Math.floor(body.ttl)), MAX_TTL);
  }

  const id = generateId();
  await redis.setex(`secret:${id}`, ttl, encrypted);

  return new Response(
    JSON.stringify({ id, ttl }),
    {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export const config = {
  runtime: 'nodejs',
};
