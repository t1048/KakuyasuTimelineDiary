// R2 Upload Proxy Endpoint
// PUT /api/upload/:key - Proxy upload to R2 bucket

interface Env {
  USER_CONTENT_BUCKET: any;
  [key: string]: any;
}

interface Context {
  request: Request;
  env: Env;
  params: {
    key: string;
  };
}

// PUT /api/upload/:key
export async function onRequestPut(context: Context): Promise<Response> {
  const { request, env, params } = context;

  try {
    // Decode the image key from URL parameter
    const imageKey = decodeURIComponent(params.key);

    // Validate image key format (should be users/{userId}/{filename})
    if (!imageKey.startsWith('users/')) {
      return Response.json({
        error: 'Invalid image key',
        message: 'Image key must start with "users/"'
      }, { status: 400 });
    }

    // Get content type from request headers
    const contentType = request.headers.get('Content-Type') || 'application/octet-stream';

    // Read request body as ArrayBuffer
    const blob = await request.arrayBuffer();

    // Upload to R2
    await env.USER_CONTENT_BUCKET.put(imageKey, blob, {
      httpMetadata: {
        contentType: contentType
      }
    });

    return Response.json({
      success: true,
      imageKey: imageKey,
      size: blob.byteLength
    });

  } catch (error) {
    console.error('Error uploading to R2:', error);
    return Response.json({
      error: 'Failed to upload to R2',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
