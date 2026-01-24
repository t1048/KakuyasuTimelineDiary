// User Consent Endpoint
// GET /consent - Get user consent status
// POST /consent - Save user consent

interface Env {
  DB: any;
  CONSENT_VERSION: string;
  [key: string]: any;
}

interface Context {
  request: Request;
  env: Env;
  user_id: string;
}

interface UserConsent {
  user_id: string;
  agreed: number;
  version: string;
  agreed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ConsentRequest {
  agreed: boolean;
  version: string;
}

// GET /consent
export async function onRequestGet(context: Context): Promise<Response> {
  const { env, user_id } = context;

  try {
    // Query user consent record
    const consent = await env.DB.prepare(
      'SELECT * FROM user_consents WHERE user_id = ?'
    ).bind(user_id).first() as UserConsent | null;

    if (!consent) {
      // No consent record found
      return Response.json({
        agreed: false,
        version: env.CONSENT_VERSION
      });
    }

    // Return consent status
    return Response.json({
      agreed: consent.agreed === 1,
      version: consent.version,
      agreedAt: consent.agreed_at
    });

  } catch (error) {
    console.error('Error fetching consent:', error);
    return Response.json({
      error: 'Failed to fetch consent',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// POST /consent
export async function onRequestPost(context: Context): Promise<Response> {
  const { request, env, user_id } = context;

  try {
    const body = await request.json() as ConsentRequest;

    // Validate request
    if (typeof body.agreed !== 'boolean' || !body.version) {
      return Response.json({
        error: 'Invalid request',
        message: 'agreed (boolean) and version (string) are required'
      }, { status: 400 });
    }

    // UPSERT consent record
    await env.DB.prepare(
      `INSERT INTO user_consents (user_id, agreed, version, agreed_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         agreed = excluded.agreed,
         version = excluded.version,
         agreed_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`
    ).bind(user_id, body.agreed ? 1 : 0, body.version).run();

    return Response.json({
      success: true,
      agreed: body.agreed,
      version: body.version
    });

  } catch (error) {
    console.error('Error saving consent:', error);
    return Response.json({
      error: 'Failed to save consent',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
