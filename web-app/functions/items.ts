// Diary Items API Endpoint
// GET /items - Retrieve diary entries for a specific month
// POST /items - Create or update diary entry

interface Env {
  DB: any;
  USER_CONTENT_BUCKET: any;
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

interface DiaryRecord {
  id: number;
  user_id: string;
  year: number;
  date: string;
  ordered_items: string;
  created_at: string;
  updated_at: string;
}

// GET /items?year=2025&month=01
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

  // Get year and month from query params or use current date
  const now = new Date();
  const year = url.searchParams.get('year') || now.getFullYear().toString();
  const month = (url.searchParams.get('month') || (now.getMonth() + 1).toString()).padStart(2, '0');

  try {
    // Query D1 for records matching user, year, and month
    const { results } = await env.DB.prepare(
      `SELECT * FROM diary_records
       WHERE user_id = ? AND year = ? AND date LIKE ?
       ORDER BY date ASC`
    ).bind(user_id, parseInt(year), `${year}-${month}%`).all();

    // Generate R2 URLs for images
    const records = results as DiaryRecord[];
    const processedRecords = await Promise.all(records.map(async (record) => {
      const orderedItems = JSON.parse(record.ordered_items);

      // Add image URLs for items with imageKey
      for (const item of orderedItems) {
        if (item.imageKey) {
          // Use authenticated proxy endpoint
          item.imageUrl = `/api/upload/${encodeURIComponent(item.imageKey)}`;
        }
      }

      return {
        ...record,
        orderedItems: orderedItems
      };
    }));

    return Response.json(processedRecords);

  } catch (error) {
    console.error('Error fetching diary records:', error);
    return Response.json({
      error: 'Failed to fetch diary records',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// POST /items
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
    const body = await request.json() as any;

    // Validate required fields
    if (!body.content && !body.imageKey) {
      return Response.json({
        error: 'Invalid request',
        message: 'Either content or imageKey is required'
      }, { status: 400 });
    }

    // Use provided date or current date
    const date = body.date || new Date().toISOString().split('T')[0];
    const year = parseInt(date.split('-')[0]);

    // Check if this is a multi-day event
    const startDate = body.startDate || date;
    const endDate = body.endDate || date;

    // Generate new item ID
    const itemId = crypto.randomUUID();

    // Create new item object
    const newItem = {
      id: itemId,
      content: body.content || '',
      name: body.name || '',
      published: new Date().toISOString(),
      tag: body.tag || [],
      startTime: body.startTime || null,
      endTime: body.endTime || null,
      imageKey: body.imageKey || null,
      imageSalt: body.imageSalt || null,
      imageIv: body.imageIv || null
    };

    // Generate list of dates to update (for multi-day events)
    const datesToUpdate = generateDateRange(startDate, endDate);

    // Update each date
    for (const currentDate of datesToUpdate) {
      const currentYear = parseInt(currentDate.split('-')[0]);

      // Fetch existing record
      const existing = await env.DB.prepare(
        'SELECT * FROM diary_records WHERE user_id = ? AND date = ?'
      ).bind(user_id, currentDate).first();

      const orderedItems = existing ? JSON.parse(existing.ordered_items) : [];

      // Add new item
      orderedItems.push(newItem);

      // UPSERT (Insert or Update)
      await env.DB.prepare(
        `INSERT INTO diary_records (user_id, year, date, ordered_items, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, date) DO UPDATE SET
           ordered_items = excluded.ordered_items,
           updated_at = CURRENT_TIMESTAMP`
      ).bind(user_id, currentYear, currentDate, JSON.stringify(orderedItems)).run();
    }

    return Response.json({
      success: true,
      itemId: itemId,
      datesUpdated: datesToUpdate
    });

  } catch (error) {
    console.error('Error creating diary item:', error);
    return Response.json({
      error: 'Failed to create diary item',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// Helper function to generate date range
function generateDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  const current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}
