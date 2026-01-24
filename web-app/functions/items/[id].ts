// Delete Diary Item Endpoint
// DELETE /items/:id?date=YYYY-MM-DD&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD

interface Env {
  DB: any;
  [key: string]: any;
}

interface Context {
  request: Request;
  env: Env;
  user_id: string;
  params: {
    id: string;
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

// DELETE /items/:id
export async function onRequestDelete(context: Context): Promise<Response> {
  const { request, env, user_id, params } = context;
  const url = new URL(request.url);

  const itemId = params.id;
  const date = url.searchParams.get('date');
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');

  // Validate required parameters
  if (!itemId) {
    return Response.json({
      error: 'Invalid request',
      message: 'Item ID is required'
    }, { status: 400 });
  }

  try {
    // Determine which dates to update
    let datesToUpdate: string[] = [];

    if (startDate && endDate) {
      // Multi-day event: delete from all dates in range
      datesToUpdate = generateDateRange(startDate, endDate);
    } else if (date) {
      // Single date: delete from specified date only
      datesToUpdate = [date];
    } else {
      return Response.json({
        error: 'Invalid request',
        message: 'Either date or startDate/endDate is required'
      }, { status: 400 });
    }

    let deletedCount = 0;

    // Delete item from each date
    for (const currentDate of datesToUpdate) {
      // Fetch existing record
      const record = await env.DB.prepare(
        'SELECT * FROM diary_records WHERE user_id = ? AND date = ?'
      ).bind(user_id, currentDate).first() as DiaryRecord | null;

      if (!record) {
        continue; // Skip if no record for this date
      }

      // Parse ordered items
      const orderedItems = JSON.parse(record.ordered_items);

      // Filter out the item to delete
      const filteredItems = orderedItems.filter((item: any) => item.id !== itemId);

      if (filteredItems.length === orderedItems.length) {
        // Item not found in this date's record
        continue;
      }

      deletedCount++;

      if (filteredItems.length === 0) {
        // No items left: delete entire record
        await env.DB.prepare(
          'DELETE FROM diary_records WHERE user_id = ? AND date = ?'
        ).bind(user_id, currentDate).run();
      } else {
        // Update record with remaining items
        await env.DB.prepare(
          `UPDATE diary_records
           SET ordered_items = ?, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ? AND date = ?`
        ).bind(JSON.stringify(filteredItems), user_id, currentDate).run();
      }
    }

    if (deletedCount === 0) {
      return Response.json({
        error: 'Item not found',
        message: `Item ${itemId} not found in specified date(s)`
      }, { status: 404 });
    }

    return Response.json({
      success: true,
      itemId: itemId,
      datesUpdated: datesToUpdate,
      deletedCount: deletedCount
    });

  } catch (error) {
    console.error('Error deleting diary item:', error);
    return Response.json({
      error: 'Failed to delete diary item',
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
