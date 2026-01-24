// Upload URL Endpoint
// POST /upload-url - Generate upload URL for images (Worker proxy pattern)

interface Env {
  DB: any;
  USER_CONTENT_BUCKET: any;
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

interface UploadRequest {
  fileName?: string;
  contentType?: string;
}

const ALLOWED_CONTENT_TYPES = [
  'application/octet-stream',
  'image/jpeg',
  'image/png',
  'image/webp'
];

// POST /upload-url
export async function onRequestPost(context: Context): Promise<Response> {
  const { request, env } = context;
  const user_id = context.data?.user_id;

  if (!user_id) {
    return Response.json({
      error: 'Unauthorized',
      message: 'Missing user id'
    }, { status: 401 });
  }

  try {
    const body = await request.json() as UploadRequest;

    // Validate content type
    const contentType = body.contentType || 'application/octet-stream';
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      return Response.json({
        error: 'Invalid content type',
        message: `Allowed types: ${ALLOWED_CONTENT_TYPES.join(', ')}`
      }, { status: 400 });
    }

    // Sanitize filename
    const fileName = sanitizeFilename(body.fileName) || `${crypto.randomUUID()}.jpg`;

    // Get current month (UTC)
    const currentMonth = getCurrentMonthUTC();

    // Get monthly upload limit
    const uploadLimit = parseInt(env.MONTHLY_IMAGE_UPLOAD_LIMIT || '50');

    // Check current upload count
    const countResult = await env.DB.prepare(
      'SELECT image_count FROM monthly_uploads WHERE user_id = ? AND month = ?'
    ).bind(user_id, currentMonth).first() as { image_count: number } | null;

    const currentCount = countResult?.image_count || 0;

    // Check if limit exceeded
    if (currentCount >= uploadLimit) {
      return Response.json({
        error: 'Monthly upload limit exceeded',
        message: '月間アップロード上限（50枚）に達しました',
        limit: uploadLimit,
        current: currentCount,
        month: currentMonth
      }, { status: 429 });
    }

    // Increment upload counter (atomically)
    await env.DB.prepare(
      `INSERT INTO monthly_uploads (user_id, month, image_count)
       VALUES (?, ?, 1)
       ON CONFLICT(user_id, month) DO UPDATE SET
         image_count = image_count + 1,
         updated_at = CURRENT_TIMESTAMP`
    ).bind(user_id, currentMonth).run();

    // Generate image key
    const imageKey = `users/${user_id}/${fileName}`;

    // Generate upload URL (Worker proxy pattern)
    // The actual upload will be handled by /api/upload/:key endpoint
    const uploadUrl = `/api/upload/${encodeURIComponent(imageKey)}`;

    return Response.json({
      uploadUrl,
      imageKey,
      uploadLimit: {
        limit: uploadLimit,
        used: currentCount + 1,
        remaining: uploadLimit - currentCount - 1,
        month: currentMonth
      }
    });

  } catch (error) {
    console.error('Error generating upload URL:', error);
    return Response.json({
      error: 'Failed to generate upload URL',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// Helper: Sanitize filename
function sanitizeFilename(fileName: string | undefined): string | null {
  if (!fileName) return null;

  // Remove backslashes and normalize
  const normalized = fileName.trim().replace(/\\/g, '/');

  // Get base name (last part of path)
  const baseName = normalized.split('/').pop() || '';

  // Replace unsafe characters with underscores
  const safe = baseName.replace(/[^A-Za-z0-9._-]/g, '_');

  // Limit length
  return safe.substring(0, 120) || null;
}

// Helper: Get current month in UTC (YYYY-MM format)
function getCurrentMonthUTC(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}
