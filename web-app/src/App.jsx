import { useEffect, useMemo, useRef, useState } from 'react';
import { Amplify } from 'aws-amplify';
import { useAuthenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { getItems, createItem, deleteItem, getConsent, setConsent, getTemplates, saveTemplate, deleteTemplate, generateRecurringInstancesForDate, getOutbox, enqueueOutboxEntry, removeOutboxEntry, updateOutboxEntry, getUploadUrl, uploadFile, fetchFile, toggleReaction } from './api';
import { Calendar, Clock, Trash2, Plus, X, LogOut, FileText, ChevronLeft, ChevronRight, KeyRound, AlertCircle, List, Settings, Pencil, Hash, CalendarDays, Camera, Send } from 'lucide-react';
import './App.css';

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
    }
  }
});

const CONSENT_VERSION = '2025-12-21';
const CONSENT_STORAGE_KEY = 'diary_consent';

const readConsentCache = () => {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(CONSENT_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.error('同意キャッシュ取得エラー:', error);
    return null;
  }
};

const writeConsentCache = (value) => {
  if (typeof window === 'undefined') return;
  try {
    if (!value) {
      localStorage.removeItem(CONSENT_STORAGE_KEY);
      return;
    }
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(value));
  } catch (error) {
    console.error('同意キャッシュ保存エラー:', error);
  }
};
const CONSENT_ITEMS = [
  '日記や予定のデータは暗号化しますが、流出が発生しても運営は責任を負いません。',
  'クライアント端末側で不具合が発生しても運営は責任を負いません。',
  'セキュリティ関連で秘密保持契約（NDA）を結んでいる情報は入力しないでください。',
  'メールアドレスや電話番号の入力が必要です。本人の同意なしに第三者提供はしませんが、アプリの維持が困難な場合は寄付のお願いを連絡する可能性があります。'
];

// Helper function to format date in local timezone as YYYY-MM-DD
const formatLocalDate = (dateObj) => {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const date = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${date}`;
};

function App() {
  const { user, signOut } = useAuthenticator();
  const userIdRaw = user?.userId || user?.username || '';
  const userIdLabel = userIdRaw ? userIdRaw.slice(-5) : 'unknown';
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isFabMenuOpen, setIsFabMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [cryptoError, setCryptoError] = useState('');
  const [viewMode, setViewMode] = useState('timeline'); // 'timeline', 'calendar', 'week'
  const [filterTag, setFilterTag] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [isDayModalOpen, setIsDayModalOpen] = useState(false);
  const [dateRangeFilter, setDateRangeFilter] = useState('all'); // 'all', 'today', 'week', 'month'
  const [typeFilter, setTypeFilter] = useState('note'); // 'all', 'note', 'event'
  const [searchQuery, setSearchQuery] = useState('');
  const [weekViewStartDate, setWeekViewStartDate] = useState(new Date()); // 週間ビューの開始日付
  const [templates, setTemplates] = useState([]); // テンプレート一覧
  const [isTemplatePanelOpen, setIsTemplatePanelOpen] = useState(false); // テンプレートパネル表示状態
  const [isStatsOpen, setIsStatsOpen] = useState(false); // 統計パネル表示状態
  const [consentStatus, setConsentStatus] = useState(() => {
    const cached = readConsentCache();
    if (cached?.agreed && cached?.version === CONSENT_VERSION) return 'agreed';
    return 'loading';
  }); // 'loading', 'required', 'agreed'
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentError, setConsentError] = useState('');
  const [consentSubmitting, setConsentSubmitting] = useState(false);
  const [hashtagQuery, setHashtagQuery] = useState('');
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [isChatSubmitting, setIsChatSubmitting] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiPickerTarget, setEmojiPickerTarget] = useState(null); // { date, itemId }
  const [reactionSubmitting, setReactionSubmitting] = useState({}); // { [itemId+emoji]: boolean }
  const notificationSupported = typeof window !== 'undefined' && 'Notification' in window;
  // データキャッシュ: キーは "YYYY-MM" 形式
  const [dataCache, setDataCache] = useState({});
  const [outbox, setOutbox] = useState(() => getOutbox());
  const [syncState, setSyncState] = useState('idle'); // 'idle', 'syncing', 'error'
  const [isOnline, setIsOnline] = useState(() => {
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine;
  });
  const syncInProgressRef = useRef(false);
  const contentTextareaRef = useRef(null);
  const [uploadLimit, setUploadLimit] = useState({
    limit: 50,
    used: 0,
    remaining: 50,
    month: null
  });
  const [uploadLimitError, setUploadLimitError] = useState(null);

  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth() + 1);

  const [formData, setFormData] = useState(() => {
    const dateStr = formatLocalDate(new Date());
    return {
      date: dateStr,
      startDate: dateStr,
      endDate: dateStr,
      startTime: '',
      endTime: '',
      title: '',
      content: '',
      quickPost: false
    };
  });

  const getStoredPin = () => (typeof window === 'undefined') ? '' : (sessionStorage.getItem('diaryPin') || '');
  const [pin, setPin] = useState(getStoredPin);
  const [pinInput, setPinInput] = useState(getStoredPin);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);

  const getNotificationSettingsKey = () => {
    if (typeof window === 'undefined') return 'diary_notification_settings';
    return `diary_notification_settings:${window.location.origin}`;
  };

  const getDefaultNotificationSettings = () => ({
    enabled: false,
    diaryTime: '21:00',
    diaryMaxPerDay: 1,
    eventLeadMinutes: 30,
    lastDiaryNotifiedDate: '',
    recentEventNotifyKeys: []
  });

  const loadNotificationSettings = () => {
    const defaults = getDefaultNotificationSettings();
    if (typeof window === 'undefined') return defaults;
    try {
      const stored = localStorage.getItem(getNotificationSettingsKey());
      if (!stored) return defaults;
      const parsed = JSON.parse(stored);
      return { ...defaults, ...parsed };
    } catch (error) {
      console.error('通知設定の読み込みエラー:', error);
      return defaults;
    }
  };

  const [notificationSettings, setNotificationSettings] = useState(loadNotificationSettings);
  const [notificationPermission, setNotificationPermission] = useState(() => {
    if (!notificationSupported) return 'unsupported';
    return Notification.permission;
  });
  const [notificationError, setNotificationError] = useState('');
  const notificationPermissionLabel = {
    granted: '許可済み',
    denied: '拒否',
    default: '未確認',
    unsupported: '未対応'
  }[notificationPermission] || '未確認';
  const consentIsAgreed = consentStatus === 'agreed';
  const consentBusy = consentStatus === 'loading' || consentSubmitting;

  useEffect(() => {
    if (pin) sessionStorage.setItem('diaryPin', pin);
    else sessionStorage.removeItem('diaryPin');
  }, [pin]);

  useEffect(() => {
    let cancelled = false;
    const loadConsent = async () => {
      try {
        const cachedConsent = readConsentCache();
        const hasCachedAgreement = cachedConsent?.agreed && cachedConsent?.version === CONSENT_VERSION;
        setConsentError('');
        if (!hasCachedAgreement) {
          setConsentStatus('loading');
        }
        const data = await getConsent();
        const agreed = data?.agreed && data?.version === CONSENT_VERSION;
        if (!cancelled) {
          setConsentStatus(agreed ? 'agreed' : 'required');
          if (agreed) {
            writeConsentCache({ agreed: true, version: CONSENT_VERSION });
          } else {
            writeConsentCache(null);
          }
          if (!agreed && data?.version && data?.version !== CONSENT_VERSION) {
            setConsentError('同意内容が更新されました。再度同意してください。');
          }
        }
      } catch (error) {
        console.error('同意情報の取得エラー:', error);
        if (!cancelled) {
          const cachedConsent = readConsentCache();
          const hasCachedAgreement = cachedConsent?.agreed && cachedConsent?.version === CONSENT_VERSION;
          if (hasCachedAgreement) {
            setConsentStatus('agreed');
          } else {
            setConsentStatus('required');
            setConsentError('同意情報の取得に失敗しました。通信状態を確認してください。');
          }
        }
      }
    };
    loadConsent();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!consentIsAgreed) {
      setIsPinModalOpen(false);
      return;
    }
    if (!pin) setIsPinModalOpen(true);
  }, [consentIsAgreed, pin]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(getNotificationSettingsKey(), JSON.stringify(notificationSettings));
    } catch (error) {
      console.error('通知設定の保存エラー:', error);
    }
  }, [notificationSettings]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (isModalOpen && contentTextareaRef.current) {
      // モーダルが開いたときにフォーカスを当て、カーソルを先頭に移動する
      const textarea = contentTextareaRef.current;
      const timer = setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(0, 0);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isModalOpen]);

  const textEncoder = useMemo(() => new TextEncoder(), []);
  const textDecoder = useMemo(() => new TextDecoder(), []);

  const toBase64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
  const fromBase64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
  const extractDateFromSk = (sk) => {
    const match = /^DATE#(\d{4}-\d{2}-\d{2})/.exec(sk || '');
    return match ? match[1] : '';
  };

  const getTagName = (tag) => {
    if (!tag) return '';
    if (typeof tag === 'string') return tag;
    if (typeof tag.name === 'string') return tag.name;
    if (typeof tag.name === 'object' && typeof tag.name.name === 'string') return tag.name.name;
    return '';
  };
  const hasTag = (tags, tagName) => (tags || []).some(tag => getTagName(tag) === tagName);
  const inferItemKind = (item) => {
    if (hasTag(item.tag, '#予定')) return 'event';
    if (hasTag(item.tag, '#日記')) return 'note';
    if (item.startTime) return 'event';
    return 'note';
  };
  const isEventItem = (item) => inferItemKind(item) === 'event';
  const toLocalDateString = (dateObj) => {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const date = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${date}`;
  };
  const getItemDate = (item) => {
    if (item.startTime) return item.startTime.split('T')[0];
    if (item.published) return item.published.split('T')[0];
    return item.date || '';
  };
  const ensureTag = (content, tag) => {
    if (!content) return `\n\n${tag}`;
    if (content.includes(tag)) return content;
    const suffix = content.endsWith('\n\n') ? '' : (content.endsWith('\n') ? '\n' : '\n\n');
    return `${content}${suffix}${tag}`;
  };

  const deriveKey = async (pinCode, salt) => {
    const keyMaterial = await crypto.subtle.importKey('raw', textEncoder.encode(pinCode), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  };

  const encryptText = async (pinCode, plainText) => {
    if (!plainText) return '';
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pinCode, salt);
    const cipherBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      textEncoder.encode(plainText)
    );
    return `enc:v1:${toBase64(salt)}:${toBase64(iv)}:${toBase64(cipherBuffer)}`;
  };

  const decryptText = async (pinCode, cipherText) => {
    if (!cipherText || !cipherText.startsWith('enc:v1:')) return cipherText;
    try {
      const parts = cipherText.split(':');
      if (parts.length < 5) return cipherText;
      const [, , saltB64, ivB64, dataB64] = parts;
      const salt = fromBase64(saltB64);
      const iv = fromBase64(ivB64);
      const data = fromBase64(dataB64);
      const key = await deriveKey(pinCode, salt);
      const plainBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        data
      );
      return textDecoder.decode(plainBuffer);
    } catch (e) {
      console.error("Decrypt failed", e);
      throw e;
    }
  };

  const updateNotificationSettings = (updates) => {
    setNotificationSettings(prev => ({ ...prev, ...updates }));
  };

  const requestNotificationPermission = async () => {
    if (!notificationSupported) {
      setNotificationPermission('unsupported');
      return 'unsupported';
    }
    const result = await Notification.requestPermission();
    setNotificationPermission(result);
    return result;
  };

  const showNotification = (title, options) => {
    if (!notificationSupported || Notification.permission !== 'granted') return false;
    try {
      new Notification(title, options);
      return true;
    } catch (error) {
      console.error('通知表示エラー:', error);
      return false;
    }
  };

  const isTimeMatch = (timeStr, date) => {
    if (!timeStr) return false;
    const [hours, minutes] = timeStr.split(':').map(Number);
    return date.getHours() === hours && date.getMinutes() === minutes;
  };

  const buildRecurringInstances = (daysAhead = 30) => {
    const instances = [];
    const base = new Date();
    for (let i = 0; i <= daysAhead; i++) {
      const date = new Date(base);
      date.setDate(base.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      instances.push(...generateRecurringInstancesForDate(dateStr));
    }
    return instances;
  };

  const getUpcomingEventCandidates = () => {
    const fromRecords = timelineItems
      .filter(item => isEventItem(item) && item.startTime)
      .map(item => ({
        id: item.id,
        title: item.name || '予定',
        content: item.content || '',
        startTime: item.startTime
      }));
    const fromRecurring = buildRecurringInstances().map(item => ({
      id: item.id,
      title: item.title || '予定',
      content: item.content || '',
      startTime: item.startTime
    }));
    return [...fromRecords, ...fromRecurring];
  };

  const maybeSendDiaryReminder = async () => {
    if (!consentIsAgreed) return;
    if (!notificationSettings.enabled || notificationPermission !== 'granted') return;
    const now = new Date();
    if (!isTimeMatch(notificationSettings.diaryTime, now)) return;
    const todayStr = now.toISOString().split('T')[0];
    if (notificationSettings.lastDiaryNotifiedDate === todayStr) return;

    const [year, month] = todayStr.split('-');
    try {
      const items = await getItems(parseInt(year, 10), parseInt(month, 10));
      const dayRecord = items.find(r => (extractDateFromSk(r.sk) || r.date) === todayStr);
      const dayItems = dayRecord?.orderedItems || [];
      const hasDiary = dayItems.some(item => inferItemKind(item) === 'note');
      if (!hasDiary) {
        const sent = showNotification('日記のリマインダー', {
          body: '今日の日記がまだ未入力です。',
          tag: 'diary-reminder'
        });
        if (sent) {
          updateNotificationSettings({ lastDiaryNotifiedDate: todayStr });
        }
      } else {
        updateNotificationSettings({ lastDiaryNotifiedDate: todayStr });
      }
    } catch (error) {
      console.error('日記チェックエラー:', error);
    }
  };

  const maybeSendEventReminders = () => {
    if (!consentIsAgreed) return;
    if (!notificationSettings.enabled || notificationPermission !== 'granted') return;
    const now = new Date();
    const leadMinutes = Number(notificationSettings.eventLeadMinutes) || 30;
    const candidates = getUpcomingEventCandidates();
    const readyEvents = candidates
      .map(event => {
        const start = new Date(event.startTime);
        if (Number.isNaN(start.getTime())) return null;
        const notifyAt = new Date(start.getTime() - leadMinutes * 60 * 1000);
        return {
          ...event,
          start,
          notifyAt,
          key: `${event.id}:${event.startTime}`
        };
      })
      .filter(Boolean)
      .filter(event => now >= event.notifyAt && now < event.start);

    if (readyEvents.length === 0) return;

    const recentKeys = Array.isArray(notificationSettings.recentEventNotifyKeys)
      ? notificationSettings.recentEventNotifyKeys
      : [];
    const nextKeys = [...recentKeys];

    readyEvents.forEach(event => {
      if (recentKeys.includes(event.key)) return;
      const minutesLeft = Math.max(1, Math.round((event.start - now) / 60000));
      const sent = showNotification('予定のリマインダー', {
        body: `${event.title} の開始まであと${minutesLeft}分です。`,
        tag: `event-reminder-${event.key}`
      });
      if (sent) {
        nextKeys.push(event.key);
      }
    });

    if (nextKeys.length !== recentKeys.length) {
      updateNotificationSettings({
        recentEventNotifyKeys: nextKeys.slice(-50)
      });
    }
  };

  const submitConsent = async () => {
    if (!consentChecked) {
      setConsentError('同意にチェックを入れてください。');
      return;
    }
    setConsentSubmitting(true);
    setConsentError('');
    try {
      await setConsent({ agreed: true, version: CONSENT_VERSION });
      writeConsentCache({ agreed: true, version: CONSENT_VERSION });
      setConsentStatus('agreed');
      setConsentChecked(false);
    } catch (error) {
      console.error('同意保存エラー:', error);
      setConsentError('同意の保存に失敗しました。通信状態を確認してください。');
    } finally {
      setConsentSubmitting(false);
    }
  };

  const loadData = async (forceReload = false) => {
    if (!pin || !consentIsAgreed) return;
    
    const cacheKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    
    // キャッシュがある場合は、それを使用（強制リロード以外）
    if (!forceReload && dataCache[cacheKey]) {
      const merged = applyOutboxOverlay(dataCache[cacheKey], getOutbox(), cacheKey);
      setRecords(merged);
      setLoading(false);
      return;
    }
    
    try {
      setCryptoError('');
      setLoading(true);
      const data = await getItems(currentYear, currentMonth);
      
      // Decrypt all items in orderedItems and fetch/decrypt images
      const decryptedRecords = await Promise.all(data.map(async (dayRecord) => {
        const recordDate = extractDateFromSk(dayRecord.sk) || dayRecord.date;
        const items = dayRecord.orderedItems || [];
        const decryptedItems = await Promise.all(items.map(async (item) => {
          try {
            const name = await decryptText(pin, item.name);
            const content = await decryptText(pin, item.content);
            let imageUrl = item.imageUrl;
            if (item.imageKey && item.imageUrl && item.imageSalt && item.imageIv) {
              try {
                const res = await fetchFile(item.imageUrl);
                if (res.ok) {
                  const buffer = await res.arrayBuffer();
                  const decryptedBlob = await decryptArrayBufferWithPin(pin, item.imageSalt, item.imageIv, buffer);
                  imageUrl = URL.createObjectURL(decryptedBlob);
                }
              } catch (e) {
                console.warn('Image decrypt/fetch failed', e);
              }
            }
            return { ...item, name, content, imageUrl, decrypted: true };
          } catch (e) {
            return {
              ...item,
              name: '🔒 Encrypted',
              content: 'Decryption failed',
              decrypted: false
            };
          }
        }));
        return { ...dayRecord, date: recordDate, orderedItems: decryptedItems };
      }));
      
      const merged = applyOutboxOverlay(decryptedRecords, getOutbox(), cacheKey);
      setRecords(merged);
      // キャッシュに保存
      setDataCache(prev => ({ ...prev, [cacheKey]: merged }));
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => { if (pin && consentIsAgreed) loadData(); }, [currentYear, currentMonth, pin, consentIsAgreed]);

  useEffect(() => {
    if (!isOnline || !pin || !consentIsAgreed || outbox.length === 0) return;
    flushOutbox();
    const intervalId = setInterval(() => {
      flushOutbox();
    }, 30000);
    return () => clearInterval(intervalId);
  }, [isOnline, pin, consentIsAgreed, outbox.length]);

  useEffect(() => {
    // テンプレート読み込み
    const loadedTemplates = getTemplates();
    setTemplates(loadedTemplates);
  }, []);

  const prevMonth = () => {
    if (currentMonth === 1) {
      setCurrentYear(y => y - 1);
      setCurrentMonth(12);
    } else {
      setCurrentMonth(m => m - 1);
    }
  };

  const nextMonth = () => {
    if (currentMonth === 12) {
      setCurrentYear(y => y + 1);
      setCurrentMonth(1);
    } else {
      setCurrentMonth(m => m + 1);
    }
  };

  // 「今日」フィルタ選択時は、週／カレンダー表示が今日を含むように表示日時を更新する
  useEffect(() => {
    if (dateRangeFilter === 'today') {
      const t = new Date();
      setCurrentYear(t.getFullYear());
      setCurrentMonth(t.getMonth() + 1);
      setWeekViewStartDate(t);
    }
  }, [dateRangeFilter]);

  // Flatten records to timeline items
  const timelineItems = useMemo(() => {
    const allItems = [];
    records.forEach(day => {
      (day.orderedItems || []).forEach(item => {
        // Avoid duplicates if item spans multiple days (check ID)
        if (!allItems.find(i => i.id === item.id)) {
          allItems.push({ ...item, date: day.date });
        }
      });
    });
    const getSortTime = (item) => {
      const timeStr = item.startTime || item.published || item.date;
      const parsed = Date.parse(timeStr);
      return Number.isNaN(parsed) ? 0 : parsed;
    };
    // Sort by published/startTime desc
    return allItems.sort((a, b) => getSortTime(b) - getSortTime(a));
  }, [records]);

  useEffect(() => {
    if (!consentIsAgreed) return;
    if (!notificationSettings.enabled || notificationPermission !== 'granted') return;
    const tick = () => {
      maybeSendDiaryReminder();
      maybeSendEventReminders();
    };
    tick();
    const intervalId = setInterval(tick, 60000);
    return () => clearInterval(intervalId);
  }, [
    notificationSettings.enabled,
    notificationSettings.diaryTime,
    notificationSettings.eventLeadMinutes,
    notificationSettings.lastDiaryNotifiedDate,
    notificationSettings.recentEventNotifyKeys,
    notificationPermission,
    consentIsAgreed,
    timelineItems
  ]);

  // Extract unique tags
  const availableTags = useMemo(() => {
    const tags = new Set();
    timelineItems.forEach(item => {
      (item.tag || []).forEach((t) => {
        const name = getTagName(t);
        if (name) tags.add(name);
      });
    });
    return Array.from(tags).sort();
  }, [timelineItems]);

  const baseFilteredItems = useMemo(() => {
    let items = timelineItems;

    // タイプフィルター
    if (typeFilter !== 'all') {
      items = items.filter(item => {
        const kind = inferItemKind(item);
        if (typeFilter === 'note') return kind === 'note';
        if (typeFilter === 'event') return kind === 'event';
        return true;
      });
    }

    // ハッシュタグフィルター
    if (filterTag) {
      items = items.filter(item => (item.tag || []).some(t => getTagName(t) === filterTag));
    }

    // テキスト検索
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      items = items.filter(item => {
        const titleMatch = (item.name || '').toLowerCase().includes(query);
        const contentMatch = (item.content || '').toLowerCase().includes(query);
        return titleMatch || contentMatch;
      });
    }

    return items;
  }, [timelineItems, filterTag, typeFilter, searchQuery]);

  const timelineFilteredItems = useMemo(() => {
    let items = baseFilteredItems;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 日付範囲フィルター
    if (dateRangeFilter !== 'all') {
      items = items.filter(item => {
        const itemDate = new Date(item.startTime || item.published || item.date);
        itemDate.setHours(0, 0, 0, 0);

        if (dateRangeFilter === 'today') {
          return itemDate.getTime() === today.getTime();
        } else if (dateRangeFilter === 'week') {
          const weekStart = new Date(today);
          weekStart.setDate(today.getDate() - today.getDay());
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekStart.getDate() + 6);
          weekEnd.setHours(23, 59, 59, 999);
          return itemDate >= weekStart && itemDate <= weekEnd;
        } else if (dateRangeFilter === 'month') {
          return itemDate.getMonth() === today.getMonth() && itemDate.getFullYear() === today.getFullYear();
        }
        return true;
      });
    }

    return items;
  }, [baseFilteredItems, dateRangeFilter]);

  const calendarDays = useMemo(() => {
    const days = [];
    const firstDay = new Date(currentYear, currentMonth - 1, 1);
    const lastDay = new Date(currentYear, currentMonth, 0);
    
    // Previous month padding
    const startPadding = firstDay.getDay(); // 0 (Sun) to 6 (Sat)
    for (let i = startPadding - 1; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - 1, -i);
      days.push({
        date: toLocalDateString(d),
        day: d.getDate(),
        isCurrentMonth: false
      });
    }
    
    // Current month days
    for (let i = 1; i <= lastDay.getDate(); i++) {
      const d = new Date(currentYear, currentMonth - 1, i);
      const dateStr = toLocalDateString(d);
      days.push({
        date: dateStr,
        day: i,
        isCurrentMonth: true,
        items: baseFilteredItems.filter(item => getItemDate(item) === dateStr)
      });
    }
    
    // Next month padding to complete the week
    const remaining = 7 - (days.length % 7);
    if (remaining < 7) {
      for (let i = 1; i <= remaining; i++) {
        const d = new Date(currentYear, currentMonth, i);
        days.push({
          date: toLocalDateString(d),
          day: i,
          isCurrentMonth: false
        });
      }
    }
    
    return days;
  }, [currentYear, currentMonth, baseFilteredItems]);

  // 週間ビュー用データ計算
  const weekViewDays = useMemo(() => {
    const days = [];
    const startDate = new Date(weekViewStartDate);
    startDate.setDate(startDate.getDate() - startDate.getDay()); // 日曜から開始
    startDate.setHours(0, 0, 0, 0);
    const todayStr = toLocalDateString(new Date());
    
    for (let i = 0; i < 7; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      const dateStr = toLocalDateString(date);
      
      days.push({
        date: dateStr,
        day: date.getDate(),
        dayOfWeek: ['日', '月', '火', '水', '木', '金', '土'][date.getDay()],
        items: baseFilteredItems.filter(item => getItemDate(item) === dateStr),
        isToday: dateStr === todayStr
      });
    }
    
    return days;
  }, [weekViewStartDate, baseFilteredItems]);

  // 統計データ計算
  const statistics = useMemo(() => {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const monthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

    // 当月のデータ取得
    const monthRecords = records.filter(r => r.date.startsWith(monthStr));
    
    // 投稿数の計算
    const notes = timelineItems.filter(i => inferItemKind(i) === 'note' && i.date.startsWith(monthStr));
    const events = timelineItems.filter(i => inferItemKind(i) === 'event' && i.date.startsWith(monthStr));
    
    // タグの頻出度計算
    const tagFrequency = {};
    timelineItems.forEach(item => {
      if (item.date.startsWith(monthStr)) {
        (item.tag || []).forEach((t) => {
          const name = getTagName(t);
          if (name) tagFrequency[name] = (tagFrequency[name] || 0) + 1;
        });
      }
    });
    const topTags = Object.entries(tagFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);

    // 連続投稿日数を計算
    let consecutiveDays = 0;
    let checkDate = new Date(today);
    checkDate.setHours(0, 0, 0, 0);
    
    while (true) {
      const dateStr = checkDate.toISOString().split('T')[0];
      const hasPost = records.some(r => r.date === dateStr && (r.orderedItems || []).length > 0);
      if (!hasPost) break;
      consecutiveDays++;
      checkDate.setDate(checkDate.getDate() - 1);
    }

    // 平均文字数を計算
    const totalChars = notes.reduce((sum, note) => sum + (note.content?.length || 0), 0);
    const avgChars = notes.length > 0 ? Math.round(totalChars / notes.length) : 0;

    return {
      notes: notes.length,
      events: events.length,
      topTags,
      consecutiveDays,
      avgChars,
      monthStr
    };
  }, [timelineItems, records]);

  const resetPin = () => {
    setPin('');
    setPinInput('');
    setRecords([]);
    setDataCache({}); // キャッシュをクリア
    setIsPinModalOpen(true);
  };

  const ensurePin = () => {
    if (!pin) {
      setCryptoError('パスワードが設定されていません');
      setIsPinModalOpen(true);
      return false;
    }
    return true;
  };

  const createQueueId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const currentMonthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

  const buildDraftFromForm = (baseId) => {
    const tags = extractHashtags(formData.content);
    const isEvent = hasTag(tags.map(name => ({ name })), '#予定');
    const id = baseId || (crypto.randomUUID ? crypto.randomUUID() : createQueueId());
    const startDate = formData.startDate || formData.date;
    const endDate = formData.endDate || startDate;
    const draft = {
      id,
      name: formData.title,
      content: formData.content,
      tag: tags.map(name => ({ name })),
      date: startDate,
      imageKey: editingItem?.imageKey,
      imageUrl: editingItem?.imageUrl
    };

    if (isEvent) {
      const startTimePart = formData.startTime || '00:00';
      const endTimePart = formData.endTime || (endDate !== startDate ? '23:59' : '');
      draft.startTime = `${startDate}T${startTimePart}:00`;
      if (endTimePart || endDate !== startDate) {
        draft.endTime = `${endDate}T${(endTimePart || startTimePart)}:00`;
      }
    } else {
      const nowTime = new Date().toTimeString().slice(0, 8);
      draft.published = `${formData.date}T${nowTime}`;
    }

    return draft;
  };

  const buildPayloadFromDraft = async (draft) => {
    const payload = {
      id: draft.id,
      name: await encryptText(pin, draft.name),
      content: await encryptText(pin, draft.content),
      tag: draft.tag,
      imageKey: draft.imageKey,
      imageSalt: draft.imageSalt,
      imageIv: draft.imageIv
    };

    if (draft.startTime) {
      payload.startTime = draft.startTime;
      if (draft.endTime) payload.endTime = draft.endTime;
    } else {
      payload.published = draft.published;
    }

    return payload;
  };

  // --- 画像バイナリ暗号化 / 復号ユーティリティ ---
  const bufToBase64 = (buffer) => toBase64(buffer);
  const base64ToBuf = (s) => fromBase64(s);

  const encryptBlobWithPin = async (pinCode, blob) => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pinCode, salt);
    const arrayBuffer = await blob.arrayBuffer();
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, arrayBuffer);
    const cipherBlob = new Blob([new Uint8Array(encrypted)], { type: 'application/octet-stream' });
    return { cipherBlob, saltB64: bufToBase64(salt), ivB64: bufToBase64(iv) };
  };

  const decryptArrayBufferWithPin = async (pinCode, saltB64, ivB64, cipherArrayBuffer) => {
    const salt = base64ToBuf(saltB64);
    const iv = base64ToBuf(ivB64);
    const key = await deriveKey(pinCode, salt);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherArrayBuffer);
    return new Blob([new Uint8Array(decrypted)], { type: 'image/jpeg' });
  };

  const updateRecordsWithItem = (draft, oldDate) => {
    const itemDate = getItemDate(draft);
    if (!itemDate) return;

    const removeById = (recordList) =>
      recordList.map((day) => ({
        ...day,
        orderedItems: (day.orderedItems || []).filter((item) => item.id !== draft.id)
      }));

    const upsertTo = (recordList) => {
      let found = false;
      const next = recordList.map((day) => {
        const filtered = (day.orderedItems || []).filter((item) => item.id !== draft.id);
        if (day.date === itemDate) {
          found = true;
          return { ...day, orderedItems: [...filtered, draft] };
        }
        return { ...day, orderedItems: filtered };
      });
      if (!found) {
        next.push({ date: itemDate, orderedItems: [draft] });
      }
      return next;
    };

    const newMonthKey = `${itemDate.split('-')[0]}-${itemDate.split('-')[1]}`;
    const oldMonthKey = oldDate ? `${oldDate.split('-')[0]}-${oldDate.split('-')[1]}` : null;

    // 現在表示中のレコードを更新
    setRecords((prev) => {
      if (newMonthKey === currentMonthKey) return upsertTo(prev);
      if (oldMonthKey === currentMonthKey) return removeById(prev);
      return prev;
    });

    // キャッシュを更新
    setDataCache((prev) => {
      const next = { ...prev };
      if (next[newMonthKey]) {
        next[newMonthKey] = upsertTo(next[newMonthKey]);
      }
      if (oldMonthKey && oldMonthKey !== newMonthKey && next[oldMonthKey]) {
        next[oldMonthKey] = removeById(next[oldMonthKey]);
      }
      return next;
    });
  };

  const removeRecordsById = (itemId) => {
    const removeFrom = (recordList) =>
      recordList.map((day) => ({
        ...day,
        orderedItems: (day.orderedItems || []).filter((item) => item.id !== itemId)
      }));

    setRecords((prev) => removeFrom(prev));
    setDataCache((prev) => {
      const next = {};
      Object.entries(prev).forEach(([key, value]) => {
        next[key] = removeFrom(value);
      });
      return next;
    });
  };

  const applyOutboxOverlay = (recordList, queue, monthKey) => {
    let next = recordList.map((day) => ({
      ...day,
      orderedItems: [...(day.orderedItems || [])]
    }));

    const upsert = (draft) => {
      const itemDate = getItemDate(draft);
      if (!itemDate) return;
      const itemMonthKey = `${itemDate.split('-')[0]}-${itemDate.split('-')[1]}`;
      if (monthKey && itemMonthKey !== monthKey) return;
      let found = false;
      next = next.map((day) => {
        const filtered = (day.orderedItems || []).filter((item) => item.id !== draft.id);
        if (day.date === itemDate) {
          found = true;
          return { ...day, orderedItems: [...filtered, draft] };
        }
        return { ...day, orderedItems: filtered };
      });
      if (!found) {
        next.push({ date: itemDate, orderedItems: [draft] });
      }
    };

    const remove = (itemId) => {
      next = next.map((day) => ({
        ...day,
        orderedItems: (day.orderedItems || []).filter((item) => item.id !== itemId)
      }));
    };

    queue.forEach((entry) => {
      if (entry.type === 'delete') {
        const targetDate = entry.params?.startDate || entry.params?.date;
        if (targetDate) {
          const entryMonthKey = `${targetDate.split('-')[0]}-${targetDate.split('-')[1]}`;
          if (monthKey && entryMonthKey !== monthKey) return;
        }
        remove(entry.params?.itemId);
      } else if (entry.type === 'create') {
        upsert(entry.draft);
      }
    });

    return next;
  };

  const enqueueCreate = (draft) => {
    const entry = {
      queueId: createQueueId(),
      type: 'create',
      draft,
      createdAt: new Date().toISOString(),
      attemptCount: 0
    };
    const next = enqueueOutboxEntry(entry);
    setOutbox(next);
    return entry;
  };

  const enqueueDelete = (params) => {
    const entry = {
      queueId: createQueueId(),
      type: 'delete',
      params,
      createdAt: new Date().toISOString(),
      attemptCount: 0
    };
    const next = enqueueOutboxEntry(entry);
    setOutbox(next);
    return entry;
  };

  const flushOutbox = async () => {
    if (!isOnline || syncInProgressRef.current) return;
    if (!pin) return;
    const queue = getOutbox();
    if (!queue.length) return;

    syncInProgressRef.current = true;
    setSyncState('syncing');

    let hadError = false;
    for (const entry of queue) {
      try {
        if (entry.type === 'create') {
          const payload = await buildPayloadFromDraft(entry.draft);
          await createItem(payload);
        } else if (entry.type === 'delete') {
          await deleteItem(entry.params);
        }
        const next = removeOutboxEntry(entry.queueId);
        setOutbox(next);
      } catch (error) {
        hadError = true;
        const next = updateOutboxEntry(entry.queueId, {
          attemptCount: (entry.attemptCount || 0) + 1,
          lastAttemptAt: new Date().toISOString(),
          lastError: String(error)
        });
        setOutbox(next);
      }
    }

    syncInProgressRef.current = false;
    setSyncState(hadError ? 'error' : 'idle');
    if (!hadError) {
      loadData(true);
    }
  };

  const buildDeleteParams = (item) => {
    const startDate = item.startTime ? item.startTime.split('T')[0] : getItemDate(item);
    const endDate = item.endTime ? item.endTime.split('T')[0] : undefined;
    return {
      itemId: item.id,
      date: item.date || startDate,
      startDate,
      endDate
    };
  };

  const handleDeleteItem = async (item) => {
    if (!item?.id) return;
    const params = buildDeleteParams(item);
    removeRecordsById(item.id);
    if (!isOnline) {
      enqueueDelete(params);
      return;
    }
    try {
      await deleteItem(params);
      loadData(true);
    } catch (error) {
      console.error(error);
      enqueueDelete(params);
      setSyncState('error');
    }
  };

  const handleSaveItem = async () => {
    if (!ensurePin()) return;
    if (formIsEvent) {
      const startDate = formData.startDate || formData.date;
      const endDate = formData.endDate || startDate;
      if (endDate < startDate) {
        alert('終了日は開始日以降にしてください');
        return;
      }
    }
    const draft = buildDraftFromForm(editingItem?.id);
    const oldDate = editingItem ? getItemDate(editingItem) : null;

    if (selectedImage) {
      try {
        const processedBlob = await processImage(selectedImage);
        const { cipherBlob, saltB64, ivB64 } = await encryptBlobWithPin(pin, processedBlob);
        const uploadContentType = processedBlob.type || selectedImage.type || 'application/octet-stream';

        let uploadResponse;
        try {
          uploadResponse = await getUploadUrl(selectedImage.name, uploadContentType);
        } catch (uploadError) {
          // 429エラー（アップロード上限超過）の特別処理
          if (uploadError.status === 429) {
            const errorData = uploadError.data || {};
            setUploadLimitError(errorData.message || '月間アップロード上限に達しました');
            alert(
              `${errorData.message || '月間アップロード上限に達しました'}\n\n` +
              `今月の利用状況: ${errorData.current || '?'}/${errorData.limit || 50}枚\n` +
              `対象月: ${errorData.month || '現在の月'}`
            );
            setSyncState('idle');
            return;
          }
          // その他のエラーはそのまま再スロー
          throw uploadError;
        }

        const { uploadUrl, imageKey: key, uploadLimit: limitInfo } = uploadResponse;

        // アップロード制限情報を更新
        if (limitInfo) {
          setUploadLimit({
            limit: limitInfo.limit,
            used: limitInfo.used,
            remaining: limitInfo.remaining,
            month: limitInfo.month
          });
          setUploadLimitError(null);
        }

        await uploadFile(uploadUrl, cipherBlob, uploadContentType);

        draft.imageKey = key;
        draft.imageSalt = saltB64;
        draft.imageIv = ivB64;
        draft.imageUrl = URL.createObjectURL(processedBlob);
      } catch (error) {
        console.error("Image upload failed:", error);
        alert(`画像のアップロードに失敗しました: ${error.message || error}`);
        setSyncState('error');
        return;
      }
    } else if (editingItem && !imagePreview) {
      // 画像が削除された場合
      draft.imageKey = null;
      draft.imageUrl = null;
    }

    // 日付が変更された場合、古いレコードを削除する必要がある（DynamoDBのSKが日付ベースのため）
    if (editingItem) {
      const oldParams = buildDeleteParams(editingItem);
      const newParams = buildDeleteParams(draft);
      const dateChanged = oldParams.startDate !== newParams.startDate || oldParams.endDate !== newParams.endDate;

      if (dateChanged) {
        if (!isOnline) {
          enqueueDelete(oldParams);
        } else {
          try {
            await deleteItem(oldParams);
          } catch (error) {
            console.error("Failed to delete old record during date change:", error);
            enqueueDelete(oldParams);
            setSyncState('error');
          }
        }
      }
    }

    updateRecordsWithItem(draft, oldDate);
    let queued = false;
    if (!isOnline) {
      enqueueCreate(draft);
      queued = true;
    } else {
      try {
        const payload = await buildPayloadFromDraft(draft);
        await createItem(payload);
      } catch (error) {
        console.error(error);
        enqueueCreate(draft);
        queued = true;
        setSyncState('error');
      }
    }

    if (!queued) {
      loadData(true);
    }
    closeModal();
    resetFormData();
  };

  const processImage = async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          const MAX_WIDTH = 800;
          const MAX_HEIGHT = 800;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;

          ctx.filter = 'none';
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob((blob) => {
            resolve(blob);
          }, 'image/jpeg', 0.5);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setSelectedImage(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleReactionToggle = async (date, itemId, emoji) => {
    const key = `${itemId}:${emoji}`;
    if (reactionSubmitting[key]) return;

    setReactionSubmitting(prev => ({ ...prev, [key]: true }));

    // Optimistic update
    setRecords(prev => prev.map(record => {
      if (record.date !== date) return record;
      const updatedItems = record.orderedItems.map(item => {
        if (item.id !== itemId) return item;
        const reactions = { ...(item.reactions || {}) };
        if (reactions[emoji] && reactions[emoji] > 0) {
          reactions[emoji] -= 1;
          if (reactions[emoji] <= 0) delete reactions[emoji];
        } else {
          reactions[emoji] = (reactions[emoji] || 0) + 1;
        }
        return { ...item, reactions };
      });
      return { ...record, orderedItems: updatedItems };
    }));

    try {
      await toggleReaction({ date, itemId, emoji });
    } catch (error) {
      console.error('Reaction toggle failed:', error);
      // Rollback on error
      setRecords(prev => prev.map(record => {
        if (record.date !== date) return record;
        const updatedItems = record.orderedItems.map(item => {
          if (item.id !== itemId) return item;
          const reactions = { ...(item.reactions || {}) };
          if (reactions[emoji] && reactions[emoji] > 0) {
            reactions[emoji] -= 1;
            if (reactions[emoji] <= 0) delete reactions[emoji];
          } else {
            reactions[emoji] = (reactions[emoji] || 0) + 1;
          }
          return { ...item, reactions };
        });
        return { ...record, orderedItems: updatedItems };
      }));
    } finally {
      setReactionSubmitting(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleAddReaction = (date, itemId, emoji) => {
    handleReactionToggle(date, itemId, emoji);
    setEmojiPickerOpen(false);
    setEmojiPickerTarget(null);
  };

  const openEmojiPicker = (date, itemId) => {
    setEmojiPickerTarget({ date, itemId });
    setEmojiPickerOpen(true);
  };

  const closeEmojiPicker = () => {
    setEmojiPickerOpen(false);
    setEmojiPickerTarget(null);
  };

  const handleChatSubmit = async (e) => {
    if (e) e.preventDefault();
    if ((!chatInput.trim() && !selectedImage) || isChatSubmitting) return;
    if (!ensurePin()) return;

    setIsChatSubmitting(true);
    try {
      const now = new Date();
      const dateStr = toLocalDateString(now);
      
      let content = chatInput.trim();
      if (!content.includes('#')) {
        content = `${content}\n\n#日記`;
      }

      let imageKey = null;
      let imageUrl = null;
      let imageSalt = null;
      let imageIv = null;

      if (selectedImage) {
        const processedBlob = await processImage(selectedImage);
        const { cipherBlob, saltB64, ivB64 } = await encryptBlobWithPin(pin, processedBlob);
        const uploadContentType = processedBlob.type || selectedImage.type || 'application/octet-stream';

        let uploadResponse;
        try {
          uploadResponse = await getUploadUrl(selectedImage.name, uploadContentType);
        } catch (uploadError) {
          if (uploadError.status === 429) {
            const errorData = uploadError.data || {};
            setUploadLimitError(errorData.message || '月間アップロード上限に達しました');
            alert(
              `${errorData.message || '月間アップロード上限に達しました'}\n\n` +
              `今月の利用状況: ${errorData.current || '?'}/${errorData.limit || 50}枚\n` +
              `対象月: ${errorData.month || '現在の月'}`
            );
            setIsChatSubmitting(false);
            return;
          }
          throw uploadError;
        }

        const { uploadUrl, imageKey: key, uploadLimit: limitInfo } = uploadResponse;

        if (limitInfo) {
          setUploadLimit({
            limit: limitInfo.limit,
            used: limitInfo.used,
            remaining: limitInfo.remaining,
            month: limitInfo.month
          });
          setUploadLimitError(null);
        }

        await uploadFile(uploadUrl, cipherBlob, uploadContentType);

        imageKey = key;
        imageUrl = URL.createObjectURL(processedBlob);
        imageSalt = saltB64;
        imageIv = ivB64;
      }

      const draft = {
        id: createQueueId(),
        date: dateStr,
        published: now.toISOString(),
        content: content,
        name: '',
        tag: extractHashtags(content).map(name => ({ name })),
        imageKey,
        imageUrl,
        imageSalt,
        imageIv
      };

      updateRecordsWithItem(draft, null);
      
      if (!isOnline) {
        enqueueCreate(draft);
      } else {
        try {
          const payload = await buildPayloadFromDraft(draft);
          await createItem(payload);
        } catch (error) {
          console.error(error);
          enqueueCreate(draft);
          setSyncState('error');
        }
      }
      
      setChatInput('');
      setSelectedImage(null);
      setImagePreview(null);
    } catch (e) {
      console.error(e);
      setCryptoError('送信に失敗しました。');
    } finally {
      setIsChatSubmitting(false);
    }
  };

  const getRelativeTime = (dateStr) => {
    if (!dateStr) return '';
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return 'たった今';
    if (diffMin < 60) return `${diffMin}分前`;
    if (diffHour < 24) return `${diffHour}時間前`;
    if (diffDay < 7) return `${diffDay}日前`;
    return dateStr.split('T')[0];
  };

  const onThisDayItems = useMemo(() => {
    const today = new Date();
    const mmdd = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const todayStr = toLocalDateString(today);
    const items = [];
    records.forEach(record => {
      if (record.date.endsWith(mmdd) && record.date !== todayStr) {
        record.orderedItems.forEach(item => {
          items.push({ ...item, year: record.date.split('-')[0] });
        });
      }
    });
    return items.sort((a, b) => b.year - a.year);
  }, [records]);

  const getSyncMessage = () => {
    if (!isOnline) {
      return outbox.length > 0
        ? `オフラインです。未同期の操作が${outbox.length}件あります。`
        : 'オフラインです。オンラインになると同期します。';
    }
    if (syncState === 'syncing') {
      return outbox.length > 0
        ? `同期中...（残り${outbox.length}件）`
        : '同期中...';
    }
    if (syncState === 'error') {
      return outbox.length > 0
        ? `同期に失敗しました。未同期の操作が${outbox.length}件あります。`
        : '同期に失敗しました。';
    }
    if (outbox.length > 0) {
      return `未同期の操作が${outbox.length}件あります。`;
    }
    return '';
  };

  const getDefaultFormData = () => {
    const now = new Date();
    const dateStr = toLocalDateString(now);
    const timeStr = now.toTimeString().slice(0, 5);
    return {
      date: dateStr,
      startDate: dateStr,
      endDate: dateStr,
      startTime: timeStr,
      endTime: '',
      title: '',
      content: '',
      quickPost: false
    };
  };

  const resetFormData = () => {
    setFormData(getDefaultFormData());
  };

  const openCreateModal = () => {
    setEditingItem(null);
    setIsFabMenuOpen(!isFabMenuOpen);
  };

  const openNoteModal = () => {
    setIsFabMenuOpen(false);
    setFormData({
      ...getDefaultFormData(),
      content: '\n\n#日記'
    });
    setSelectedImage(null);
    setImagePreview(null);
    setIsModalOpen(true);
  };

  const openEventModal = () => {
    setIsFabMenuOpen(false);
    setFormData({
      ...getDefaultFormData(),
      content: '\n\n#予定'
    });
    setSelectedImage(null);
    setImagePreview(null);
    setIsModalOpen(true);
  };

  const goToToday = () => {
    const today = new Date();
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth() + 1);
  };

  const openEditModal = (item) => {
    if (!item) return;
    setEditingItem(item);
    const isEvent = isEventItem(item);
    let date = item.date;
    let startDate = date;
    let endDate = date;
    let startTime = '';
    let endTime = '';
    let content = item.content || '';

    if (isEvent && item.startTime) {
      startDate = item.startTime.split('T')[0];
      date = startDate;
      startTime = item.startTime.split('T')[1]?.slice(0, 5) || '';
      if (item.endTime) {
        endDate = item.endTime.split('T')[0];
        endTime = item.endTime.split('T')[1]?.slice(0, 5) || '';
      }
      content = ensureTag(content, '#予定');
    } else if (item.published) {
      date = item.published.split('T')[0];
      startDate = date;
      endDate = date;
    }

    setFormData({
      date,
      startDate,
      endDate,
      startTime,
      endTime,
      title: item.name || '',
      content,
      quickPost: formData.quickPost || false
    });
    setSelectedImage(null);
    setImagePreview(item.imageUrl || null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingItem(null);
    setSelectedImage(null);
    setImagePreview(null);
  };

  const closeDayModal = () => {
    setIsDayModalOpen(false);
    setSelectedDate(null);
  };

  const openDayModal = (dateStr) => {
    setSelectedDate(dateStr);
    setIsDayModalOpen(true);
  };

  const extractHashtags = (text) => {
    const regex = /#[\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\uFF66-\uFF9F]+/g;
    const matches = text.match(regex);
    return matches ? matches : [];
  };

  const getHashtagQueryAtCursor = (text, cursorPos) => {
    const uptoCursor = text.slice(0, cursorPos);
    const hashIndex = uptoCursor.lastIndexOf('#');
    if (hashIndex === -1) return null;
    const beforeHash = hashIndex === 0 ? '' : uptoCursor[hashIndex - 1];
    if (beforeHash && !/\s/.test(beforeHash)) return null;
    const fragment = uptoCursor.slice(hashIndex + 1);
    if (/\s/.test(fragment)) return null;
    return fragment;
  };

  const insertHashtag = (tag) => {
    const textarea = contentTextareaRef.current;
    if (!textarea) return;
    const value = formData.content || '';
    const cursorPos = textarea.selectionStart || 0;
    const query = getHashtagQueryAtCursor(value, cursorPos);
    let newValue = value;
    let nextCursorPos = cursorPos;

    if (query !== null) {
      const uptoCursor = value.slice(0, cursorPos);
      const hashIndex = uptoCursor.lastIndexOf('#');
      const before = value.slice(0, hashIndex);
      const after = value.slice(cursorPos);
      newValue = `${before}${tag}${after}`;
      nextCursorPos = before.length + tag.length;
    } else {
      const before = value.slice(0, cursorPos);
      const after = value.slice(cursorPos);
      const inHashtag = /#[^\s#]+$/.test(before);
      const prefix = inHashtag ? ' ' : (before ? (before.endsWith('\n\n') ? '' : (before.endsWith('\n') ? '\n' : '\n\n')) : '\n\n');
      newValue = `${before}${prefix}${tag}${after}`;
      nextCursorPos = before.length + prefix.length + tag.length;
    }

    setFormData({ ...formData, content: newValue });
    setHashtagQuery('');
    setShowTagSuggestions(false);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursorPos, nextCursorPos);
    }, 0);
  };

  const formTags = useMemo(() => extractHashtags(formData.content), [formData.content]);
  const formIsEvent = useMemo(() => hasTag(formTags, '#予定'), [formTags]);

  const suggestedTags = useMemo(() => {
    const baseTags = availableTags.filter(tag => tag !== '#日記' && tag !== '#予定');
    if (!showTagSuggestions) return [];
    if (!hashtagQuery) return baseTags;
    const query = hashtagQuery.toLowerCase();
    return baseTags.filter(tag => tag.toLowerCase().includes(query));
  }, [availableTags, hashtagQuery, showTagSuggestions]);

  const renderContentWithTags = (content) => {
    if (!content) return null;
    const parts = content.split(/(#[\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\uFF66-\uFF9F]+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('#')) {
        return (
          <span key={i} className="hashtag" onClick={(e) => {
            e.stopPropagation();
            setFilterTag(part === filterTag ? null : part);
          }}>
            {part}
          </span>
        );
      }
      return part;
    });
  };

  return (
    <>
      <div className="app-container">
            <header className="header">
            <h1>Daily Life</h1>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setIsStatsOpen(true)} className="logout-btn" title="統計">
                📊
              </button>
              <button onClick={() => setIsSettingsOpen(true)} className="logout-btn" title="設定">
                <Settings size={18} />
              </button>
              <button onClick={resetPin} className="logout-btn" title="パスワード再入力">
                <KeyRound size={18} />
              </button>
              <button onClick={() => { resetPin(); signOut(); }} className="logout-btn" title="ログアウト">
                <LogOut size={20} />
              </button>
            </div>
          </header>

          <div style={{
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            padding: '16px 20px 0', 
            gap: '20px',
            background: 'white'
          }}>
            <button onClick={prevMonth} className="logout-btn"><ChevronLeft/></button>
            <h2 style={{margin:0, fontSize:'1.2rem', color:'#37474F'}}>
              {currentYear}年 {currentMonth}月
            </h2>
            <button onClick={nextMonth} className="logout-btn"><ChevronRight/></button>
            <button 
              onClick={goToToday} 
              className="logout-btn" 
              title="今日へ移動"
              style={{
                marginLeft: 'auto',
                padding: '6px 12px',
                fontSize: '0.85rem',
                background: '#FF6B6B',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'background 0.2s'
              }}
            >
              今日
            </button>
          </div>

          <div className="view-switch">
            <button className={`view-btn ${viewMode === 'timeline' ? 'active' : ''}`} onClick={() => setViewMode('timeline')}>
              <List size={16}/> タイムライン
            </button>
            <button className={`view-btn ${viewMode === 'week' ? 'active' : ''}`} onClick={() => setViewMode('week')}>
              <CalendarDays size={16}/> 週間
            </button>
            <button className={`view-btn ${viewMode === 'calendar' ? 'active' : ''}`} onClick={() => setViewMode('calendar')}>
              <Calendar size={16}/> カレンダー
            </button>
          </div>

          {viewMode === 'timeline' && (
            <>
              <div className="filter-bar">
                <div className="filter-group">
                  <button 
                    className={`filter-btn ${dateRangeFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setDateRangeFilter('all')}
                  >
                    全て
                  </button>
                  <button 
                    className={`filter-btn ${dateRangeFilter === 'today' ? 'active' : ''}`}
                    onClick={() => setDateRangeFilter('today')}
                  >
                    今日
                  </button>
                  <button 
                    className={`filter-btn ${dateRangeFilter === 'week' ? 'active' : ''}`}
                    onClick={() => setDateRangeFilter('week')}
                  >
                    今週
                  </button>
                  <button 
                    className={`filter-btn ${dateRangeFilter === 'month' ? 'active' : ''}`}
                    onClick={() => setDateRangeFilter('month')}
                  >
                    今月
                  </button>
                </div>
              </div>

              <div className="type-tab-bar">
                <button 
                  className={`type-tab ${typeFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setTypeFilter('all')}
                >
                  全て
                </button>
                <button 
                  className={`type-tab ${typeFilter === 'note' ? 'active' : ''}`}
                  onClick={() => setTypeFilter('note')}
                >
                  📝 日記
                </button>
                <button 
                  className={`type-tab ${typeFilter === 'event' ? 'active' : ''}`}
                  onClick={() => setTypeFilter('event')}
                >
                  📌 予定
                </button>
              </div>

              <div className="search-bar">
                <input 
                  type="text" 
                  placeholder="タイトル・内容で検索..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="search-input"
                />
              </div>

              {availableTags.length > 0 && (
                <div className="tag-filter-bar">
                  {availableTags.map(tag => (
                    <button 
                      key={tag} 
                      className={`tag-chip ${filterTag === tag ? 'active' : ''}`}
                      onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {viewMode === 'calendar' && availableTags.length > 0 && (
            <div className="tag-filter-bar">
              {availableTags.map(tag => (
                <button 
                  key={tag} 
                  className={`tag-chip ${filterTag === tag ? 'active' : ''}`}
                  onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}

          <main className="main-content">
            {loading ? (
              <p className="loading">読み込み中...</p>
            ) : (
              <>
                {getSyncMessage() && (
                  <div className={`alert ${!isOnline ? 'warn' : syncState === 'error' ? 'error' : 'info'}`}>
                    <AlertCircle size={18}/>
                    <span>{getSyncMessage()}</span>
                    {isOnline && outbox.length > 0 && (
                      <button
                        className="link-btn info"
                        onClick={flushOutbox}
                        disabled={syncState === 'syncing'}
                      >
                        同期する
                      </button>
                    )}
                  </div>
                )}
                {cryptoError && (
                  <div className="alert error">
                    <AlertCircle size={18}/>
                    <span>{cryptoError}</span>
                    <button className="link-btn" onClick={resetPin}>パスワードを再入力</button>
                  </div>
                )}

                {viewMode === 'timeline' ? (
                  timelineFilteredItems.length === 0 ? (
                    <div className="empty-state">
                      <FileText size={48} color="#e0e0e0" style={{marginBottom: 20}} />
                      <p>表示するアイテムがありません。<br/>新しい投稿を作成しましょう！</p>
                    </div>
                  ) : (
                    <div className="timeline-list">
                      {onThisDayItems.length > 0 && (
                        <div className="on-this-day-section">
                          <h3 className="section-title">✨ 過去の今日の記録</h3>
                          <div className="on-this-day-grid">
                            {onThisDayItems.map(item => (
                              <div key={item.id} className="on-this-day-card" onClick={() => openEditModal(item)}>
                                <div className="on-this-day-year">{item.year}年</div>
                                <div className="on-this-day-content">{item.content.slice(0, 50)}...</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {timelineFilteredItems.map((item) => (
                      <div key={item.id} className={`sns-post ${isEventItem(item) ? 'event' : 'note'}`}>
                        <div className="post-header">
                          <div className="post-user-info">
                            <div className="post-avatar">{userIdLabel[0].toUpperCase()}</div>
                            <div className="post-meta">
                              <span className="post-user-id">ID: {userIdLabel}</span>
                              <span className="post-time">
                                {isEventItem(item) ? <Clock size={10} /> : null}
                                {getRelativeTime(isEventItem(item) ? item.startTime : item.published)}
                              </span>
                            </div>
                          </div>
                          <div className="post-actions">
                            <button className="post-action-btn" onClick={() => openEditModal(item)}>
                              <Pencil size={14} />
                            </button>
                            <button className="post-action-btn delete" onClick={() => {
                              if (!confirm('削除しますか？')) return;
                              handleDeleteItem(item);
                            }}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                        <div className="post-body">
                          {item.name && <h4 className="post-title">{item.name}</h4>}
                          <div className="post-content">{renderContentWithTags(item.content)}</div>
                          {item.imageUrl && (
                            <div className="post-image">
                              <img src={item.imageUrl} alt="Post" loading="lazy" />
                            </div>
                          )}
                        </div>
                        <div className="reaction-bar">
                          {Object.entries(item.reactions || {}).map(([emoji, count]) => (
                            <button
                              key={emoji}
                              className={`reaction-btn ${count > 0 ? 'active' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReactionToggle(item.date, item.id, emoji);
                              }}
                              disabled={reactionSubmitting[`${item.id}:${emoji}`]}
                              title={emoji}
                            >
                              <span className="reaction-emoji">{emoji}</span>
                              <span className="reaction-count">{count}</span>
                            </button>
                          ))}
                          <button
                            className="reaction-btn add-reaction"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEmojiPicker(item.date, item.id);
                            }}
                            title="リアクションを追加"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>
                    ))}

                    {/* Emoji Picker */}
                    {emojiPickerOpen && emojiPickerTarget && (
                      <div className="emoji-picker-overlay" onClick={closeEmojiPicker}>
                        <div className="emoji-picker" onClick={(e) => e.stopPropagation()}>
                          <div className="emoji-picker-header">
                            <span>リアクション</span>
                            <button className="emoji-picker-close" onClick={closeEmojiPicker}>
                              <X size={16} />
                            </button>
                          </div>
                          <div className="emoji-picker-grid">
                            {['👍','❤️','😆','🤔','😢','🎉','🚀','💯','🔥','🍺','💤','😋','👏','😍','🤣','😭','🙏','✨','💪','🌟'].map(emoji => (
                              <button
                                key={emoji}
                                className="emoji-picker-item"
                                onClick={() => handleAddReaction(emojiPickerTarget.date, emojiPickerTarget.itemId, emoji)}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              ) : viewMode === 'week' ? (
                  <div className="week-view-panel">
                    <div className="week-nav">
                      <button onClick={() => setWeekViewStartDate(new Date(weekViewStartDate.getTime() - 7 * 24 * 60 * 60 * 1000))} className="week-nav-btn">
                        <ChevronLeft size={18} />
                      </button>
                      <span className="week-label">
                        {weekViewDays[0].date} - {weekViewDays[6].date}
                      </span>
                      <button onClick={() => setWeekViewStartDate(new Date(weekViewStartDate.getTime() + 7 * 24 * 60 * 60 * 1000))} className="week-nav-btn">
                        <ChevronRight size={18} />
                      </button>
                    </div>
                    <div className="week-grid">
                      {weekViewDays.map(day => (
                        <div key={day.date} className={`week-day ${day.isToday ? 'today' : ''}`}>
                          <div className="week-day-header">
                            <div className="week-day-name">{day.dayOfWeek}</div>
                            <div className="week-day-num">{day.day}</div>
                          </div>
                          <div className="week-day-items" onClick={() => openDayModal(day.date)} style={{ cursor: 'pointer', justifyContent: 'center', alignItems: 'center' }}>
                            <div className="day-items" style={{ gap: '8px' }}>
                              {day.items?.some(item => !isEventItem(item)) && <div className="day-item-dot note" style={{ width: '10px', height: '10px' }} title="日記あり" />}
                              {day.items?.some(item => isEventItem(item)) && <div className="day-item-dot event" style={{ width: '10px', height: '10px' }} title="予定あり" />}
                            </div>
                          </div>
                          <button 
                            className="week-day-add-btn"
                            onClick={() => {
                              setFormData(prev => ({...prev, date: day.date, startDate: day.date, endDate: day.date}));
                              setIsModalOpen(true);
                            }}
                            title="この日に投稿を追加"
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="calendar-panel">
                    <div className="calendar-header-row">
                      {['日', '月', '火', '水', '木', '金', '土'].map(d => (
                        <div key={d} className="calendar-weekday">{d}</div>
                      ))}
                    </div>
                    <div className="calendar-grid">
                      {calendarDays.map((day, i) => (
                        <button
                          key={i} 
                          type="button"
                          className={`calendar-cell ${day.isCurrentMonth ? '' : 'other-month'} ${day.date === toLocalDateString(new Date()) ? 'today' : ''}`}
                          onClick={() => day.isCurrentMonth ? openDayModal(day.date) : null}
                          disabled={!day.isCurrentMonth}
                          aria-label={`${day.date} ${day.isCurrentMonth ? '' : '(他の月)'} ${day.items?.length ? `${day.items.length}件` : ''}`.trim()}
                        >
                          <span className="day-number">{day.day}</span>
                          <div className="day-items">
                            {day.items?.some(item => !isEventItem(item)) && <div className="day-item-dot note" title="日記あり" />}
                            {day.items?.some(item => isEventItem(item)) && <div className="day-item-dot event" title="予定あり" />}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </main>

        </div>
        {/* End of .app-container */}

        {consentIsAgreed && !isPinModalOpen && (
          <div className="chat-bar-container">
            {imagePreview && (
              <div className="chat-image-preview">
                <img src={imagePreview} alt="Preview" />
                <button className="remove-image-btn" onClick={() => { setSelectedImage(null); setImagePreview(null); }}>
                  <X size={14} />
                </button>
              </div>
            )}
            <form className="chat-bar" onSubmit={handleChatSubmit}>
              <label className="chat-icon-btn" style={{ cursor: 'pointer' }}>
                <Camera size={20} />
                <input 
                  type="file" 
                  accept="image/*" 
                  style={{ display: 'none' }} 
                  onChange={handleImageChange}
                />
              </label>
              <textarea 
                className="chat-input" 
                placeholder="今なにしてる？" 
                value={chatInput}
                onChange={(e) => {
                  setChatInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleChatSubmit();
                  }
                }}
                rows="1"
                disabled={isChatSubmitting}
              />
              <button type="submit" className="chat-send-btn" disabled={(!chatInput.trim() && !selectedImage) || isChatSubmitting}>
                <Send size={20} />
              </button>
            </form>
          </div>
        )}

        {/* Modals rendered outside .app-container for proper viewport positioning */}


        {isModalOpen && (
            <div className="form-screen">
              <div className="form-screen-header">
                <h2 className="form-screen-title">{editingItem ? '編集' : '新規投稿'}</h2>
                <button className="close-btn" onClick={closeModal} aria-label="閉じる">
                  <X size={20}/>
                </button>
              </div>
              <div className="form-screen-body">
                <div className="form-screen-content">
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    handleSaveItem();
                  }}>
                    {!formIsEvent && (
                      <div className="form-group">
                        <label>日付</label>
                        <input type="date" className="input-field" 
                          value={formData.date} 
                          onChange={e => {
                            const nextDate = e.target.value;
                            setFormData(prev => ({
                              ...prev,
                              date: nextDate,
                              startDate: prev.startDate === prev.date ? nextDate : prev.startDate,
                              endDate: prev.endDate === prev.date ? nextDate : prev.endDate
                            }));
                          }} required />
                      </div>
                    )}

                    {formIsEvent && (
                      <div className="form-group" style={{display:'flex', gap:10}}>
                        <div style={{flex:1}}>
                          <label>開始日</label>
                          <input type="date" className="input-field"
                            value={formData.startDate}
                            onChange={e => {
                              const nextDate = e.target.value;
                              setFormData(prev => ({
                                ...prev,
                                startDate: nextDate,
                                date: nextDate,
                                endDate: prev.endDate === prev.startDate ? nextDate : prev.endDate
                              }));
                            }} required />
                        </div>
                        <div style={{flex:1}}>
                          <label>終了日</label>
                          <input type="date" className="input-field"
                            value={formData.endDate}
                            onChange={e => setFormData({...formData, endDate: e.target.value})} required />
                        </div>
                      </div>
                    )}

                    {formIsEvent && (
                      <div className="form-group" style={{display:'flex', gap:10}}>
                        <div style={{flex:1}}>
                          <label>開始時間</label>
                          <input type="time" className="input-field" 
                            value={formData.startTime} 
                            onChange={e => setFormData({...formData, startTime: e.target.value})} required />
                        </div>
                        <div style={{flex:1}}>
                          <label>終了時間</label>
                          <input type="time" className="input-field" 
                            value={formData.endTime} 
                            onChange={e => setFormData({...formData, endTime: e.target.value})} />
                        </div>
                      </div>
                    )}

                    <div className="form-group">
                      <label>タイトル (任意)</label>
                      <input type="text" className="input-field" placeholder="タイトル" 
                        value={formData.title} 
                        onChange={e => setFormData({...formData, title: e.target.value})} />
                    </div>

                    <div className="form-group">
                      <label>内容 (ハッシュタグ #日記 / #予定 で種類を決めます)</label>
                      <textarea
                        ref={contentTextareaRef}
                        className="input-field"
                        rows="6"
                        placeholder="今なにしてる？ #日記"
                        value={formData.content}
                        onChange={e => {
                          const nextValue = e.target.value;
                          const cursorPos = e.target.selectionStart || 0;
                          const query = getHashtagQueryAtCursor(nextValue, cursorPos);
                          setFormData({...formData, content: nextValue});
                          if (query !== null) {
                            setHashtagQuery(query);
                            setShowTagSuggestions(true);
                          } else {
                            setHashtagQuery('');
                            setShowTagSuggestions(false);
                          }
                        }}
                        onBlur={() => setTimeout(() => setShowTagSuggestions(false), 150)}
                        onFocus={(e) => {
                          const cursorPos = e.target.selectionStart || 0;
                          const query = getHashtagQueryAtCursor(e.target.value, cursorPos);
                          if (query !== null) {
                            setHashtagQuery(query);
                            setShowTagSuggestions(true);
                          }
                        }}
                        required
                      ></textarea>
                      <div style={{display: 'flex', gap: '8px', marginTop: '8px'}}>
                        <button 
                          type="button" 
                          className="tag-insert-btn"
                          onClick={() => insertHashtag('#日記')}
                        >
                          <Hash size={14} style={{marginRight: 4}} />
                          日記
                        </button>
                        <button 
                          type="button" 
                          className="tag-insert-btn"
                          onClick={() => insertHashtag('#予定')}
                        >
                          <Hash size={14} style={{marginRight: 4}} />
                          予定
                        </button>
                      </div>
                      {showTagSuggestions && suggestedTags.length > 0 && (
                        <div className="tag-suggestions">
                          {suggestedTags.map(tag => (
                            <button
                              key={tag}
                              type="button"
                              className="tag-suggestion"
                              onClick={() => insertHashtag(tag)}
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="form-group">
                      <label>画像</label>
                      <div className="image-upload-area">
                        {imagePreview ? (
                          <div className="modal-image-preview">
                            <img src={imagePreview} alt="Preview" />
                            <button type="button" className="remove-image-btn" onClick={() => { setSelectedImage(null); setImagePreview(null); }}>
                              <X size={16} />
                            </button>
                          </div>
                        ) : (
                          <label className="image-upload-placeholder">
                            <Camera size={32} />
                            <span>画像を選択</span>
                            <input type="file" accept="image/*" style={{display:'none'}} onChange={handleImageChange} />
                          </label>
                        )}
                      </div>
                    </div>

                    {uploadLimit.month && (
                      <div className="upload-limit-info" style={{
                        fontSize: '0.85rem',
                        color: uploadLimit.remaining < 10 ? '#d32f2f' : '#666',
                        marginBottom: '8px',
                        padding: '8px',
                        backgroundColor: uploadLimit.remaining < 10 ? '#ffebee' : '#f5f5f5',
                        borderRadius: '4px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <span>
                          今月のアップロード: {uploadLimit.used}/{uploadLimit.limit}枚
                        </span>
                        <span style={{ fontWeight: 'bold' }}>
                          残り: {uploadLimit.remaining}枚
                        </span>
                      </div>
                    )}

                    {uploadLimitError && (
                      <div className="upload-limit-error" style={{
                        color: '#d32f2f',
                        backgroundColor: '#ffebee',
                        padding: '12px',
                        borderRadius: '4px',
                        marginBottom: '12px',
                        fontSize: '0.9rem'
                      }}>
                        {uploadLimitError}
                      </div>
                    )}

                    {!formIsEvent && (
                      <div className="form-group">
                        <label className="checkbox-label">
                          <input type="checkbox" 
                            checked={formData.quickPost} 
                            onChange={e => setFormData({...formData, quickPost: e.target.checked})} />
                          短い投稿は確認なしで投稿（{formData.content.length} 字）
                        </label>
                        <p style={{fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '4px 0 0'}}>
                          50字以下の場合、確認画面なしで投稿できます
                        </p>
                      </div>
                    )}

                    <div className="form-group template-buttons">
                      {templates.length > 0 && (
                        <button 
                          type="button"
                          className="template-btn"
                          onClick={() => setIsTemplatePanelOpen(!isTemplatePanelOpen)}
                        >
                          📋 テンプレート ({templates.length})
                        </button>
                      )}
                      <button 
                        type="button"
                        className="template-btn"
                        onClick={() => {
                          const name = prompt('テンプレート名を入力してください:');
                          if (name) {
                            saveTemplate({
                              name,
                              isEvent: formIsEvent,
                              title: formData.title,
                              content: formData.content,
                                  startDate: formData.startDate,
                                  endDate: formData.endDate,
                              startTime: formData.startTime,
                              endTime: formData.endTime
                            });
                            setTemplates(getTemplates());
                            alert('テンプレートを保存しました！');
                          }
                        }}
                      >
                        ⭐ 現在の内容を保存
                      </button>
                    </div>

                    <button type="submit" className="submit-btn">投稿する</button>
                  </form>

                  {isTemplatePanelOpen && templates.length > 0 && (
                    <div className="template-panel">
                      <h4>テンプレート一覧</h4>
                      <div className="template-list">
                        {templates.map(template => (
                          <button
                            key={template.id}
                            type="button"
                            className="template-item"
                            onClick={() => {
                              const templateIsEvent = template.isEvent || hasTag(extractHashtags(template.content || ''), '#予定');
                              const nextContent = templateIsEvent ? ensureTag(template.content, '#予定') : template.content;
                              setFormData(prev => ({
                                ...prev,
                                date: prev.date,
                                startDate: template.startDate || prev.startDate || prev.date,
                                endDate: template.endDate || prev.endDate || template.startDate || prev.startDate || prev.date,
                                startTime: template.startTime || prev.startTime,
                                endTime: template.endTime || prev.endTime || '',
                                title: template.title,
                                content: nextContent,
                                quickPost: prev.quickPost
                              }));
                              setIsTemplatePanelOpen(false);
                            }}
                          >
                            <div className="template-item-content">
                              <div className="template-name">{template.name}</div>
                              <div className="template-type">
                                {(template.isEvent || hasTag(extractHashtags(template.content || ''), '#予定')) ? '📌 予定' : '📝 日記'}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="template-delete-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm('テンプレートを削除しますか？')) {
                                  deleteTemplate(template.id);
                                  setTemplates(getTemplates());
                                }
                              }}
                            >
                              ✕
                            </button>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {consentIsAgreed && !isPinModalOpen && !isModalOpen && (
            <div className={`fab-container ${isFabMenuOpen ? 'open' : ''}`}>
              {isFabMenuOpen && (
                <div className="fab-menu">
                  <button className="fab-item note-fab" onClick={openNoteModal} title="日記・メモ">
                    <span className="fab-label">投稿</span>
                    <div className="fab-icon">
                      <FileText size={24} />
                    </div>
                  </button>
                  <button className="fab-item event-fab" onClick={openEventModal} title="予定">
                    <span className="fab-label">予定</span>
                    <div className="fab-icon">
                      <CalendarDays size={24} />
                    </div>
                  </button>
                </div>
              )}
              <button className={`fab ${isFabMenuOpen ? 'active' : ''}`} onClick={openCreateModal} title={isFabMenuOpen ? "閉じる" : "投稿を追加"}>
                {isFabMenuOpen ? <X size={32} strokeWidth={3} /> : <Plus size={32} strokeWidth={3} />}
              </button>
            </div>
          )}

          {isDayModalOpen && selectedDate && (
            <div className="modal-overlay" onClick={closeDayModal}>
              <div className="modal day-modal day-detail-view" onClick={e => e.stopPropagation()}>
                <div className="modal-header day-detail-header">
                  <div>
                    <h2>{selectedDate}</h2>
                    <p className="day-detail-subtitle">
                      {new Date(selectedDate + 'T00:00:00').toLocaleDateString('ja-JP', {weekday: 'long', month: 'long', day: 'numeric'})}
                    </p>
                  </div>
                  <button className="close-btn" onClick={closeDayModal}>
                    <X size={20}/>
                  </button>
                </div>
                
                <div className="day-items-list">
                  {records.find(r => r.date === selectedDate)?.orderedItems?.length > 0 ? (
                    <>
                      <div className="day-stats">
                        <span className="stat">
                          📝 日記: {records.find(r => r.date === selectedDate)?.orderedItems?.filter(i => !isEventItem(i)).length}
                        </span>
                        <span className="stat">
                          📌 予定: {records.find(r => r.date === selectedDate)?.orderedItems?.filter(i => isEventItem(i)).length}
                        </span>
                      </div>

                      {/* 予定（時系列） */}
                      {records.find(r => r.date === selectedDate)?.orderedItems?.filter(i => isEventItem(i)).length > 0 && (
                        <div className="day-section">
                          <h3 className="day-section-title">📌 予定</h3>
                          {records.find(r => r.date === selectedDate)?.orderedItems?.filter(i => isEventItem(i)).sort((a, b) => {
                            const timeA = a.startTime || '';
                            const timeB = b.startTime || '';
                            return timeA.localeCompare(timeB);
                          }).map(item => (
                            <div key={item.id} className="day-item event">
                              <div className="item-header">
                                <div className="item-info">
                                  {isEventItem(item) && item.startTime && (
                                    <p className="item-time">
                                      <Clock size={14} style={{marginRight: 6}} />
                                      <strong>{item.startTime?.split('T')[1]?.slice(0, 5)}</strong>
                                      {item.endTime && <span> - {item.endTime?.split('T')[1]?.slice(0, 5)}</span>}
                                    </p>
                                  )}
                                  <span className="user-id-badge compact">ID: {userIdLabel}</span>
                                  {item.name && <h4 className="item-title">{item.name}</h4>}
                                </div>
                                <div style={{display: 'flex', gap: '8px', flexShrink: 0}}>
                                  <button className="icon-btn" onClick={() => {
                                    openEditModal(item);
                                    closeDayModal();
                                  }} title="編集">
                                    <Pencil size={16} />
                                  </button>
                                  <button className="icon-btn delete" onClick={() => {
                                    if (!confirm('削除しますか？')) return;
                                    handleDeleteItem(item);
                                    closeDayModal();
                                  }} title="削除">
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </div>
                              {item.content && <p className="item-content">{renderContentWithTags(item.content)}</p>}
                              {item.imageUrl && (
                                <div className="day-item-image">
                                  <img src={item.imageUrl} alt="Post" loading="lazy" />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 日記 */}
                      {records.find(r => r.date === selectedDate)?.orderedItems?.filter(i => !isEventItem(i)).length > 0 && (
                        <div className="day-section">
                          <h3 className="day-section-title">📝 日記</h3>
                          {records.find(r => r.date === selectedDate)?.orderedItems?.filter(i => !isEventItem(i)).map(item => (
                            <div key={item.id} className="day-item note">
                              <div className="item-header">
                                <div className="item-info">
                                  <span className="user-id-badge compact">ID: {userIdLabel}</span>
                                  {item.name && <h4 className="item-title">{item.name}</h4>}
                                </div>
                                <div style={{display: 'flex', gap: '8px', flexShrink: 0}}>
                                  <button className="icon-btn" onClick={() => {
                                    openEditModal(item);
                                    closeDayModal();
                                  }} title="編集">
                                    <Pencil size={16} />
                                  </button>
                                  <button className="icon-btn delete" onClick={() => {
                                    if (!confirm('削除しますか？')) return;
                                    handleDeleteItem(item);
                                    closeDayModal();
                                  }} title="削除">
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </div>
                              {item.content && <p className="item-content">{renderContentWithTags(item.content)}</p>}
                              {item.imageUrl && (
                                <div className="day-item-image">
                                  <img src={item.imageUrl} alt="Post" loading="lazy" />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="empty-day">
                      <FileText size={48} color="#e0e0e0" style={{marginBottom: 12}} />
                      <p>この日の投稿はまだありません</p>
                    </div>
                  )}
                </div>

                <div className="day-modal-actions">
                  <button className="submit-btn" onClick={() => {
                    setFormData(prev => ({...prev, date: selectedDate, startDate: selectedDate, endDate: selectedDate}));
                    setIsModalOpen(true);
                    closeDayModal();
                  }}>
                    <Plus size={16} style={{marginRight: 8}} />
                    この日に新規投稿
                  </button>
                </div>
              </div>
            </div>
          )}

          {isSettingsOpen && (
            <div className="modal-overlay" onClick={() => setIsSettingsOpen(false)}>
              <div className="modal settings-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <h2>設定</h2>
                  <button className="close-btn" onClick={() => setIsSettingsOpen(false)}>
                    <X size={20}/>
                  </button>
                </div>
                <div className="settings-section">
                  <h3>ログインユーザー</h3>
                  <p className="settings-value">{user?.userId || user?.username || 'unknown'}</p>
                </div>
                <div className="settings-section">
                  <h3>通知</h3>
                  {!notificationSupported && (
                    <p className="settings-note">このブラウザでは通知機能が利用できません。</p>
                  )}
                  {notificationSupported && (
                    <>
                      <div className="settings-row">
                        <span className="settings-label">通知を有効化</span>
                        <label className="settings-switch">
                          <input
                            type="checkbox"
                            checked={notificationSettings.enabled}
                            onChange={async (e) => {
                              const nextEnabled = e.target.checked;
                              setNotificationError('');
                              if (nextEnabled) {
                                const result = await requestNotificationPermission();
                                if (result !== 'granted') {
                                  updateNotificationSettings({ enabled: false });
                                  setNotificationError('通知の許可が必要です。');
                                  return;
                                }
                              }
                              updateNotificationSettings({ enabled: nextEnabled });
                            }}
                          />
                          <span className="settings-slider"></span>
                        </label>
                      </div>
                      <div className="settings-row">
                        <span className="settings-label">権限</span>
                        <div className="settings-inline">
                          <span className={`settings-pill ${notificationPermission}`}>
                            {notificationPermissionLabel}
                          </span>
                          <button
                            type="button"
                            className="settings-btn"
                            onClick={async () => {
                              setNotificationError('');
                              const result = await requestNotificationPermission();
                              if (result !== 'granted') {
                                setNotificationError('通知の許可が必要です。');
                              }
                            }}
                            disabled={notificationPermission === 'granted'}
                          >
                            許可を取得
                          </button>
                        </div>
                      </div>
                      <div className="settings-row">
                        <span className="settings-label">日記通知時刻</span>
                        <input
                          type="time"
                          className="settings-input"
                          value={notificationSettings.diaryTime}
                          onChange={(e) => updateNotificationSettings({ diaryTime: e.target.value })}
                        />
                      </div>
                      <div className="settings-row">
                        <span className="settings-label">予定通知</span>
                        <div className="settings-inline">
                          <input
                            type="number"
                            min={5}
                            max={240}
                            step={5}
                            className="settings-input settings-number"
                            value={notificationSettings.eventLeadMinutes}
                            onChange={(e) => updateNotificationSettings({ eventLeadMinutes: Number(e.target.value) })}
                          />
                          <span className="settings-unit">分前（デフォルト30分）</span>
                        </div>
                      </div>
                      {notificationError && (
                        <p className="settings-error">{notificationError}</p>
                      )}
                      <p className="settings-note">通知設定はこの端末にのみ保存されます。</p>
                    </>
                  )}
                </div>
                <div className="settings-section">
                  <h3>サポート</h3>
                  <p style={{color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '12px'}}>
                    このアプリが気に入ったら、ぜひサポートをお願いします！
                  </p>
                  <a 
                    href="https://ko-fi.com/t1048" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="kofi-btn"
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style={{marginRight: 8}}>
                      <path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 7.324-.022 11.822c.164 2.424 2.586 2.672 2.586 2.672s8.267-.023 11.966-.049c2.438-.426 2.683-2.566 2.658-3.734 4.352.24 7.422-2.831 6.649-6.916zm-11.062 3.511c-1.246 1.453-4.011 3.976-4.011 3.976s-.121.119-.31.023c-.076-.057-.108-.09-.108-.09-.443-.441-3.368-3.049-4.034-3.954-.709-.965-1.041-2.7-.091-3.71.951-1.01 3.005-1.086 4.363.407 0 0 1.565-1.782 3.468-.963 1.904.82 1.832 3.011.723 4.311zm6.173.478c-.928.116-1.682.028-1.682.028V7.284h1.77s1.971.551 1.971 2.638c0 1.913-.985 2.667-2.059 3.015z"/>
                    </svg>
                    Ko-fiでサポート
                  </a>
                </div>
              </div>
            </div>
          )}

          {isStatsOpen && (
            <div className="modal-overlay" onClick={() => setIsStatsOpen(false)}>
              <div className="modal stats-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <h2>📊 {statistics.monthStr} の統計</h2>
                  <button className="close-btn" onClick={() => setIsStatsOpen(false)}>
                    <X size={20}/>
                  </button>
                </div>
                
                <div className="stats-content">
                  <div className="stats-grid">
                    <div className="stat-card">
                      <div className="stat-label">📝 日記</div>
                      <div className="stat-value">{statistics.notes}</div>
                      <div className="stat-unit">件</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">📌 予定</div>
                      <div className="stat-value">{statistics.events}</div>
                      <div className="stat-unit">件</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">🔥 連続投稿</div>
                      <div className="stat-value">{statistics.consecutiveDays}</div>
                      <div className="stat-unit">日</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">📏 平均文字数</div>
                      <div className="stat-value">{statistics.avgChars}</div>
                      <div className="stat-unit">字</div>
                    </div>
                  </div>

                  {statistics.topTags.length > 0 && (
                    <div className="stats-section">
                      <h3>よく使われたタグ</h3>
                      <div className="tags-list">
                        {statistics.topTags.map(tag => (
                          <div key={tag} className="tag-item">{tag}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="stats-section">
                    <h3>アクティビティ</h3>
                    <p className="stats-text">
                      今月は{statistics.notes + statistics.events}件の投稿をしています。
                      {statistics.consecutiveDays > 0 && (
                        <>今{statistics.consecutiveDays}日間連続で投稿中です！</>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {consentStatus !== 'agreed' && (
            <div className="modal-overlay" onClick={() => {}}>
              <div className="modal consent-modal">
                <div className="modal-header">
                  <h2>利用同意</h2>
                </div>
                <div className="consent-body">
                  <p className="consent-lead">
                    {consentStatus === 'loading'
                      ? '同意情報を確認しています...'
                      : '本アプリを利用するため、以下の内容に同意してください。'}
                  </p>
                  <ul className="consent-list">
                    {CONSENT_ITEMS.map((item, index) => (
                      <li key={`${index}-${item}`}>{item}</li>
                    ))}
                  </ul>
                  <p className="consent-note">同意バージョン: {CONSENT_VERSION}</p>
                </div>
                <label className="consent-check">
                  <input
                    type="checkbox"
                    checked={consentChecked}
                    onChange={(e) => setConsentChecked(e.target.checked)}
                    disabled={consentBusy}
                  />
                  上記に同意します
                </label>
                {consentError && <p className="consent-error">{consentError}</p>}
                <button
                  type="button"
                  className="submit-btn"
                  onClick={submitConsent}
                  disabled={!consentChecked || consentBusy}
                >
                  {consentSubmitting ? '保存中...' : '同意して開始'}
                </button>
              </div>
            </div>
          )}

          {consentIsAgreed && isPinModalOpen && (
            <div className="modal-overlay" onClick={() => {}}>
              <div className="modal pin-modal">
                <div className="modal-header">
                  <h2>パスワード入力</h2>
                  <p className="pin-tip">アプリ起動時は4桁のパスワードで日記・予定を暗号化します。</p>
                </div>
                <form onSubmit={(e) => {
                  e.preventDefault();
                  if (!/^[0-9]{4}$/.test(pinInput)) {
                    setCryptoError('4桁の数字で入力してください');
                    return;
                  }
                  setCryptoError('');
                  setPin(pinInput);
                  setRecords([]);
                  setIsPinModalOpen(false);
                }}>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={4}
                    className="pin-input"
                    placeholder="例: 1234"
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    autoComplete="one-time-code"
                    autoFocus
                    required
                  />
                  <button type="submit" className="submit-btn">決定</button>
                  <p className="pin-footnote">※ パスワードは端末には保存せず、このセッションのみで利用します。</p>
                </form>
              </div>
            </div>
          )}
    </>
  );
}

export default App;
