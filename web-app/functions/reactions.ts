// Reaction API Endpoint
// POST /reactions - Toggle emoji reaction on a diary item

interface Env {
  DB: any;
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

// POST /reactions
// Body: { date: string, itemId: string, emoji: string }
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
    if (!body.date || !body.itemId || !body.emoji) {
      return Response.json({
        error: 'Invalid request',
        message: 'date, itemId, and emoji are required'
      }, { status: 400 });
    }

    const { date, itemId, emoji } = body;

    // Validate emoji is actually an emoji (1-4 characters)
    if (!isValidEmoji(emoji)) {
      return Response.json({
        error: 'Invalid request',
        message: 'emoji must be a valid emoji character'
      }, { status: 400 });
    }

    // Fetch existing record
    const existing = await env.DB.prepare(
      'SELECT * FROM diary_records WHERE user_id = ? AND date = ?'
    ).bind(user_id, date).first() as DiaryRecord | null;

    if (!existing) {
      return Response.json({
        error: 'Not found',
        message: 'Diary record not found for the given date'
      }, { status: 404 });
    }

    const orderedItems = JSON.parse(existing.ordered_items);

    // Find the target item
    const itemIndex = orderedItems.findIndex((item: any) => item.id === itemId);
    if (itemIndex === -1) {
      return Response.json({
        error: 'Not found',
        message: 'Item not found in the diary record'
      }, { status: 404 });
    }

    // Toggle reaction
    const item = orderedItems[itemIndex];
    const reactions = item.reactions || {};

    if (reactions[emoji] && reactions[emoji] > 0) {
      // Remove reaction (decrement, delete if zero)
      reactions[emoji] -= 1;
      if (reactions[emoji] <= 0) {
        delete reactions[emoji];
      }
    } else {
      // Add reaction
      reactions[emoji] = (reactions[emoji] || 0) + 1;
    }

    // Update item
    item.reactions = reactions;
    orderedItems[itemIndex] = item;

    // Save back to DB
    await env.DB.prepare(
      `UPDATE diary_records
       SET ordered_items = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND date = ?`
    ).bind(JSON.stringify(orderedItems), user_id, date).run();

    return Response.json({
      success: true,
      itemId,
      emoji,
      reactions,
      added: reactions[emoji] !== undefined
    });

  } catch (error) {
    console.error('Error toggling reaction:', error);
    return Response.json({
      error: 'Failed to toggle reaction',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// Validate that the string is a valid emoji (1-4 code points)
function isValidEmoji(str: string): boolean {
  if (!str || str.length === 0 || str.length > 8) return false;

  // Check if the string consists only of emoji characters
  // This regex matches common emoji patterns including ZWJ sequences
  const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F|[\u{1F1E6}-\u{1F1FF}]{2}|\p{Emoji}(?:\u200D\p{Emoji})+)+$/u;
  return emojiRegex.test(str);
}
