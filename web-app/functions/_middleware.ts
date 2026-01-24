// JWT Authentication Middleware for Cloudflare Pages Functions
// Validates AWS Cognito JWT tokens

import { jwtVerify, createRemoteJWKSet } from 'jose';

interface Env {
  AWS_REGION: string;
  USER_POOL_ID: string;
  USER_POOL_CLIENT_ID: string;
  DB: any;
  USER_CONTENT_BUCKET: any;
  CONSENT_VERSION: string;
  MONTHLY_IMAGE_UPLOAD_LIMIT: string;
}

interface Context {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
  user_id?: string;
  params?: Record<string, string>;
}

export async function onRequest(context: Context): Promise<Response> {
  const { request, env, next } = context;

  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      }
    });
  }

  // Extract Authorization header
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized', message: 'Missing Authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Remove 'Bearer ' prefix if present
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.substring(7)
      : authHeader;

    // Create JWKS endpoint for Cognito
    const JWKS = createRemoteJWKSet(
      new URL(`https://cognito-idp.${env.AWS_REGION}.amazonaws.com/${env.USER_POOL_ID}/.well-known/jwks.json`)
    );

    // Verify JWT token
    const { payload } = await jwtVerify(token, JWKS, {
      audience: env.USER_POOL_CLIENT_ID,
      issuer: `https://cognito-idp.${env.AWS_REGION}.amazonaws.com/${env.USER_POOL_ID}`
    });

    // Attach user_id to context for downstream functions
    context.user_id = payload.sub as string;

    // Continue to the next middleware or handler
    const response = await next();

    // Add CORS headers to response
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Access-Control-Allow-Origin', '*');
    newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });

  } catch (err) {
    console.error('JWT verification failed:', err);
    return new Response(JSON.stringify({
      error: 'Invalid token',
      message: err instanceof Error ? err.message : 'Token verification failed'
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
