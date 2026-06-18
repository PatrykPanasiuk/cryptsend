const DEFAULT_TTL = 86400;
const MAX_TTL = 604800;
const MAX_BODY_SIZE = 10240;

function generateId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getKv() {
  try {
    const { kv } = await import('@vercel/kv');
    return kv;
  } catch {
    return null;
  }
}

export async function POST(request) {
  const kv = await getKv();
  if (!kv) {
    return new Response(
      JSON.stringify({ error: 'Server-side storage is not configured.' }),
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
  await kv.setex(`secret:${id}`, ttl, encrypted);

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
  const kv = await getKv();
  if (!kv) {
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

  const encrypted = await kv.get(`secret:${id}`);

  if (!encrypted) {
    return new Response(
      JSON.stringify({ error: 'Secret not found or already viewed.' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  await kv.del(`secret:${id}`);

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
  runtime: 'nodejs22.x',
};
