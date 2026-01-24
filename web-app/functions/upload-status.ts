// Upload Status Endpoint
// GET /upload-status?month=YYYY-MM - Check monthly upload limit status

interface Env {
  DB: any;
  MONTHLY_IMAGE_UPLOAD_LIMIT: string;
  [key: string]: any;
}

interface Context {
  request: Request;
  env: Env;
  data?: {
    user_id?: string;
    [key: string]: any;
  };
}

interface MonthlyUpload {
  id: number;
  user_id: string;
  month: string;
  image_count: number;
  created_at: string;
  updated_at: string;
}

// GET /upload-status
export async function onRequestGet(context: Context): Promise<Response> {
  const { request, env } = context;
  const user_id = context.data?.user_id;
  const url = new URL(request.url);

  if (!user_id) {
    return Response.json({
      error: 'Unauthorized',
      message: 'Missing user id'
    }, { status: 401 });
  }

  try {
    // Get month from query parameter or use current month
    const month = url.searchParams.get('month') || getCurrentMonthUTC();

    // Validate month format (YYYY-MM)
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return Response.json({
        error: 'Invalid month format',
        message: 'Month must be in YYYY-MM format'
      }, { status: 400 });
    }

    // Get upload limit
    const limit = parseInt(env.MONTHLY_IMAGE_UPLOAD_LIMIT || '50');

    // Query upload count for the month
    const result = await env.DB.prepare(
      'SELECT image_count FROM monthly_uploads WHERE user_id = ? AND month = ?'
    ).bind(user_id, month).first() as MonthlyUpload | null;

    const used = result?.image_count || 0;
    const remaining = Math.max(0, limit - used);
    const isLimitReached = used >= limit;

    return Response.json({
      limit,
      used,
      remaining,
      month,
      isLimitReached
    });

  } catch (error) {
    console.error('Error fetching upload status:', error);
    return Response.json({
      error: 'Failed to fetch upload status',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// Helper: Get current month in UTC (YYYY-MM format)
function getCurrentMonthUTC(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}
