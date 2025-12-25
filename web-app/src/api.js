import { fetchAuthSession } from 'aws-amplify/auth';

const API_URL = import.meta.env.VITE_API_URL;
const CLOUDFRONT_DOMAIN = import.meta.env.VITE_CLOUDFRONT_DOMAIN;

const getHeaders = async () => {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens.idToken.toString(); 
    return {
      'Content-Type': 'application/json',
      'Authorization': token
    };
  } catch (error) {
    console.error("Auth session error:", error);
    return { 'Content-Type': 'application/json' };
  }
};

// 年月を指定して取得
export const getItems = async (year, month) => {
  const headers = await getHeaders();
  // クエリパラメータを構築
  const query = new URLSearchParams({ 
    year: year.toString(), 
    month: month.toString().padStart(2, '0') 
  });
  const res = await fetch(`${API_URL}/items?${query}`, { headers });
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
};

export const createItem = async (data) => {
  const headers = await getHeaders();
  const res = await fetch(`${API_URL}/items`, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create');
  return res.json();
};

// 削除時にIDと日付範囲を渡す必要がある
export const deleteItem = async ({ itemId, date, startDate, endDate }) => {
  const headers = await getHeaders();
  const query = new URLSearchParams();
  if (itemId) query.set('itemId', itemId);
  if (date) query.set('date', date);
  if (startDate) query.set('startDate', startDate);
  if (endDate) query.set('endDate', endDate);
  
  const res = await fetch(`${API_URL}/items/${itemId}?${query}`, {
    method: 'DELETE',
    headers: headers
  });
  if (!res.ok) throw new Error('Failed to delete');
  return res.json();
};

export const getConsent = async () => {
  const headers = await getHeaders();
  const res = await fetch(`${API_URL}/consent`, { headers });
  if (!res.ok) throw new Error('Failed to fetch consent');
  return res.json();
};

export const setConsent = async ({ agreed, version }) => {
  const headers = await getHeaders();
  const res = await fetch(`${API_URL}/consent`, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ agreed, version }),
  });
  if (!res.ok) throw new Error('Failed to save consent');
  return res.json();
};

export const getUploadUrl = async (fileName, contentType) => {
  const headers = await getHeaders();
  const res = await fetch(`${API_URL}/upload-url`, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ fileName, contentType }),
  });
  if (!res.ok) throw new Error('Failed to get upload URL');
  const data = await res.json();
  
  // CloudFrontドメインが設定されている場合は、S3 URLをCloudFront URLに置き換え
  if (CLOUDFRONT_DOMAIN && data.uploadUrl) {
    data.uploadUrl = data.uploadUrl.replace(
      /https:\/\/s3\.[^.]+\.amazonaws\.com\/[^/]+\//,
      `https://${CLOUDFRONT_DOMAIN}/`
    );
  }
  
  return data;
};

export const uploadFile = async (url, file, contentType, extraHeaders = {}) => {
  const headers = {
    'Content-Type': contentType,
    ...extraHeaders
  };

  // Debug: リクエスト前にヘッダを出力（CORS デバッグ用）
  console.debug('Uploading file to S3 with headers:', headers, 'url:', url);

  try {
    const res = await fetch(url, {
      method: 'PUT',
      mode: 'cors',
      headers,
      body: file
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('File upload failed', { status: res.status, statusText: res.statusText, body: text, url });
      throw new Error(`Failed to upload file: ${res.status} ${res.statusText} ${text}`);
    }

    return res;
  } catch (err) {
    console.error('Network error while uploading file:', err);
    throw err;
  }
};

// オフライン同期キュー（ローカルストレージ）
const OUTBOX_STORAGE_KEY = 'diary_outbox';

const readOutbox = () => {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(OUTBOX_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('同期キュー取得エラー:', error);
    return [];
  }
};

const writeOutbox = (outbox) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(outbox));
};

export const getOutbox = () => readOutbox();

export const enqueueOutboxEntry = (entry) => {
  const outbox = readOutbox();
  const next = [...outbox, entry];
  writeOutbox(next);
  return next;
};

export const removeOutboxEntry = (queueId) => {
  const outbox = readOutbox();
  const next = outbox.filter((entry) => entry.queueId !== queueId);
  writeOutbox(next);
  return next;
};

export const updateOutboxEntry = (queueId, updates) => {
  const outbox = readOutbox();
  const next = outbox.map((entry) =>
    entry.queueId === queueId ? { ...entry, ...updates } : entry
  );
  writeOutbox(next);
  return next;
};

// テンプレート管理（ローカルストレージ）
const TEMPLATE_STORAGE_KEY = 'diary_templates';

export const getTemplates = () => {
  try {
    const templates = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    return templates ? JSON.parse(templates) : [];
  } catch (error) {
    console.error('テンプレート取得エラー:', error);
    return [];
  }
};

export const saveTemplate = (template) => {
  try {
    const templates = getTemplates();
    const newTemplate = {
      id: Date.now().toString(),
      name: template.name,
      isEvent: template.isEvent,
      title: template.title,
      content: template.content,
      startDate: template.startDate || '',
      endDate: template.endDate || '',
      startTime: template.startTime || '',
      endTime: template.endTime || '',
      createdAt: new Date().toISOString()
    };
    templates.push(newTemplate);
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
    return newTemplate;
  } catch (error) {
    console.error('テンプレート保存エラー:', error);
    throw error;
  }
};

export const deleteTemplate = (templateId) => {
  try {
    let templates = getTemplates();
    templates = templates.filter(t => t.id !== templateId);
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
  } catch (error) {
    console.error('テンプレート削除エラー:', error);
    throw error;
  }
};

export const updateTemplate = (templateId, updates) => {
  try {
    let templates = getTemplates();
    templates = templates.map(t => 
      t.id === templateId ? { ...t, ...updates } : t
    );
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
  } catch (error) {
    console.error('テンプレート更新エラー:', error);
    throw error;
  }
};

// 定期予定管理（ローカルストレージ）
const RECURRING_EVENTS_KEY = 'recurring_events';

export const getRecurringEvents = () => {
  try {
    const events = localStorage.getItem(RECURRING_EVENTS_KEY);
    return events ? JSON.parse(events) : [];
  } catch (error) {
    console.error('定期予定取得エラー:', error);
    return [];
  }
};

export const addRecurringEvent = (event) => {
  try {
    const events = getRecurringEvents();
    const newEvent = {
      id: Date.now().toString(),
      title: event.title,
      content: event.content,
      startTime: event.startTime,
      endTime: event.endTime,
      frequency: event.frequency, // 'daily', 'weekly', 'monthly'
      daysOfWeek: event.daysOfWeek || [], // 週間単位の場合
      dayOfMonth: event.dayOfMonth || null, // 月間単位の場合
      isActive: true,
      createdAt: new Date().toISOString()
    };
    events.push(newEvent);
    localStorage.setItem(RECURRING_EVENTS_KEY, JSON.stringify(events));
    return newEvent;
  } catch (error) {
    console.error('定期予定追加エラー:', error);
    throw error;
  }
};

export const deleteRecurringEvent = (eventId) => {
  try {
    let events = getRecurringEvents();
    events = events.filter(e => e.id !== eventId);
    localStorage.setItem(RECURRING_EVENTS_KEY, JSON.stringify(events));
  } catch (error) {
    console.error('定期予定削除エラー:', error);
    throw error;
  }
};

// 定期予定を指定日に展開
export const generateRecurringInstancesForDate = (date) => {
  const events = getRecurringEvents().filter(e => e.isActive);
  const instances = [];
  const dateObj = new Date(date + 'T00:00:00');
  
  events.forEach(event => {
    let shouldInclude = false;
    
    if (event.frequency === 'daily') {
      shouldInclude = true;
    } else if (event.frequency === 'weekly') {
      const dayOfWeek = dateObj.getDay();
      shouldInclude = event.daysOfWeek && event.daysOfWeek.includes(dayOfWeek);
    } else if (event.frequency === 'monthly') {
      shouldInclude = dateObj.getDate() === event.dayOfMonth;
    }
    
    if (shouldInclude) {
      instances.push({
        id: `${event.id}_${date}`,
        title: event.title,
        content: event.content,
        startTime: `${date}T${event.startTime}:00`,
        endTime: event.endTime ? `${date}T${event.endTime}:00` : null,
        isRecurring: true,
        recurringEventId: event.id
      });
    }
  });
  
  return instances;
};

