const DEFAULT_TTL = 86400;
const MAX_TTL = 604800;
const MAX_BODY_SIZE = 10240;

function generateId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getRedis() {
  const url = process.env.KV_URL || process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.REDIS_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  const { Redis } = await import('@upstash/redis');
  return new Redis({ url, token });
}

export async function POST(request) {
  const redis = await getRedis();
  if (!redis) {
    return new Response(
      JSON.stringify({ error: 'Server-side storage is not configured. Set KV_URL and KV_REST_API_TOKEN environment variables.' }),
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

  if (!encrypted || typeof encrypted !== 'string') {
    return new Response(
      JSON.stringify({ error: 'Missing required field: encrypted.' }),
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
  if (body.ttl && typeof body.ttl === 'number') {
    ttl = Math.min(Math.max(60, body.ttl), MAX_TTL);
  }

  const id = generateId();
  await redis.setex(`secret:${id}`, ttl, encrypted);

  return new Response(
    JSON.stringify({ id, ttl }),
    {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  );
}

export async function GET(request) {
  const redis = await getRedis();
  if (!redis) {
    return new Response(
      JSON.stringify({ error: 'Server-side storage is not configured.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) {
    return new Response(
      JSON.stringify({ error: 'Missing required parameter: id.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const encrypted = await redis.get(`secret:${id}`);

  if (!encrypted) {
    return new Response(
      JSON.stringify({ error: 'Secret not found or already viewed.' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  await redis.del(`secret:${id}`);

  return new Response(
    JSON.stringify({ encrypted }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  );
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export const config = {
  runtime: 'nodejs',
};
