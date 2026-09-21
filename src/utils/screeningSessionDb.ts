import { ScreeningItem, ScreeningSession, ScreeningSource } from '../types/screening';

export const SCREENING_CRITERIA_VERSION = '2026-09-04-v1';

const DB_NAME = 'taewoong-literature-screening';
const DB_VERSION = 1;
const SESSION_STORE = 'sessions';
const RESULT_STORE = 'results';

interface CachedScreeningResult {
  id: string;
  identifier: string;
  category: string;
  subModel: string;
  criteriaVersion: string;
  item: ScreeningItem;
  updatedAt: string;
}

const normalize = (value: string) => value.trim().toLowerCase();

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        const sessions = db.createObjectStore(SESSION_STORE, { keyPath: 'id' });
        sessions.createIndex('context', ['category', 'subModel', 'criteriaVersion'], { unique: false });
      }
      if (!db.objectStoreNames.contains(RESULT_STORE)) {
        const results = db.createObjectStore(RESULT_STORE, { keyPath: 'id' });
        results.createIndex('context', ['category', 'subModel', 'criteriaVersion'], { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const buildScreeningSessionId = (
  category: string,
  subModel: string,
  source: ScreeningSource,
  variant: string
) => [SCREENING_CRITERIA_VERSION, category, subModel, source, variant]
  .map(normalize)
  .join('::');

// 중복 판정은 같은 품목(category)의 모든 세부 모델이 공유한다.
const buildResultId = (category: string, identifier: string) =>
  [SCREENING_CRITERIA_VERSION, category, identifier]
    .map(normalize)
    .join('::');

export async function saveScreeningSession(session: ScreeningSession): Promise<void> {
  const db = await openDb();
  try {
    const transaction = db.transaction([SESSION_STORE, RESULT_STORE], 'readwrite');
    transaction.objectStore(SESSION_STORE).put(session);

    const resultStore = transaction.objectStore(RESULT_STORE);
    session.items.forEach((item) => {
      // 실제 AI 판정만 재사용한다. Review와 Duplicated는 원 판정을 덮어쓰지 않는다.
      if (item.aiDecision !== 'Include' && item.aiDecision !== 'Exclude') return;
      const identifier = normalize(item.id || item.doi || item.title);
      if (!identifier) return;
      const cached: CachedScreeningResult = {
        id: buildResultId(session.category, identifier),
        identifier,
        category: session.category,
        subModel: item.subModel || session.subModel,
        criteriaVersion: session.criteriaVersion,
        item,
        updatedAt: session.updatedAt,
      };
      resultStore.put(cached);
    });

    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function getScreeningSession(id: string): Promise<ScreeningSession | null> {
  const db = await openDb();
  try {
    const transaction = db.transaction(SESSION_STORE, 'readonly');
    const value = await requestToPromise<ScreeningSession | undefined>(
      transaction.objectStore(SESSION_STORE).get(id)
    );
    return value || null;
  } finally {
    db.close();
  }
}

export async function getCachedScreeningItem(
  category: string,
  _subModel: string,
  identifier: string
): Promise<ScreeningItem | null> {
  const normalizedIdentifier = normalize(identifier);
  if (!normalizedIdentifier) return null;

  const db = await openDb();
  try {
    const transaction = db.transaction(RESULT_STORE, 'readonly');
    const store = transaction.objectStore(RESULT_STORE);
    const all = await requestToPromise<CachedScreeningResult[]>(store.getAll());
    // 새 품목 범위 캐시와 기존 세부 모델 범위 캐시를 모두 찾아 재사용한다.
    return all.find((result) =>
      result.category === category &&
      result.criteriaVersion === SCREENING_CRITERIA_VERSION &&
      result.identifier === normalizedIdentifier
    )?.item || null;
  } finally {
    db.close();
  }
}

export async function listScreeningSessions(
  category: string,
  subModel: string
): Promise<ScreeningSession[]> {
  const db = await openDb();
  try {
    const transaction = db.transaction(SESSION_STORE, 'readonly');
    const all = await requestToPromise<ScreeningSession[]>(
      transaction.objectStore(SESSION_STORE).getAll()
    );
    return all
      .filter((session) =>
        session.category === category &&
        session.subModel === subModel &&
        session.criteriaVersion === SCREENING_CRITERIA_VERSION
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } finally {
    db.close();
  }
}

export async function deleteScreeningSession(id: string): Promise<void> {
  const db = await openDb();
  try {
    const transaction = db.transaction(SESSION_STORE, 'readwrite');
    transaction.objectStore(SESSION_STORE).delete(id);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function clearAllScreeningData(): Promise<void> {
  const db = await openDb();
  try {
    const transaction = db.transaction([SESSION_STORE, RESULT_STORE], 'readwrite');
    transaction.objectStore(SESSION_STORE).clear();
    transaction.objectStore(RESULT_STORE).clear();
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function clearScreeningDataForContext(
  category: string,
  subModel: string
): Promise<void> {
  const db = await openDb();
  try {
    const transaction = db.transaction([SESSION_STORE, RESULT_STORE], 'readwrite');
    const sessionStore = transaction.objectStore(SESSION_STORE);
    const resultStore = transaction.objectStore(RESULT_STORE);
    const [sessions, results] = await Promise.all([
      requestToPromise<ScreeningSession[]>(sessionStore.getAll()),
      requestToPromise<CachedScreeningResult[]>(resultStore.getAll()),
    ]);

    sessions
      .filter((session) => session.category === category && session.subModel === subModel)
      .forEach((session) => sessionStore.delete(session.id));
    // 해당 품목의 결과 캐시를 비운 뒤, 삭제되지 않은 다른 세부 모델의 실제 판정으로 재구성한다.
    results
      .filter((result) => result.category === category)
      .forEach((result) => resultStore.delete(result.id));

    sessions
      .filter((session) =>
        session.category === category &&
        session.subModel !== subModel &&
        session.criteriaVersion === SCREENING_CRITERIA_VERSION
      )
      .forEach((session) => {
        session.items.forEach((item) => {
          if (item.aiDecision !== 'Include' && item.aiDecision !== 'Exclude') return;
          const identifier = normalize(item.id || item.doi || item.title);
          if (!identifier) return;
          resultStore.put({
            id: buildResultId(category, identifier),
            identifier,
            category,
            subModel: item.subModel || session.subModel,
            criteriaVersion: SCREENING_CRITERIA_VERSION,
            item,
            updatedAt: session.updatedAt,
          } satisfies CachedScreeningResult);
        });
      });

    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function clearScreeningDataForCategory(category: string): Promise<void> {
  const db = await openDb();
  try {
    const transaction = db.transaction([SESSION_STORE, RESULT_STORE], 'readwrite');
    const sessionStore = transaction.objectStore(SESSION_STORE);
    const resultStore = transaction.objectStore(RESULT_STORE);
    const [sessions, results] = await Promise.all([
      requestToPromise<ScreeningSession[]>(sessionStore.getAll()),
      requestToPromise<CachedScreeningResult[]>(resultStore.getAll()),
    ]);

    sessions
      .filter((session) => session.category === category)
      .forEach((session) => sessionStore.delete(session.id));
    results
      .filter((result) => result.category === category)
      .forEach((result) => resultStore.delete(result.id));

    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export function mergeScreeningSessionItems(sessions: ScreeningSession[]): ScreeningItem[] {
  const merged = new Map<string, ScreeningItem>();
  sessions
    .slice()
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .forEach((session) => {
      session.items.forEach((item) => {
        const key = normalize(item.id || item.doi || item.title);
        if (!key) return;
        const previous = merged.get(key);
        const searchSources = Array.from(
          new Set([...(previous?.searchSources || []), ...(item.searchSources || []), session.label])
        );
        // 중복 표시가 먼저 저장된 실제 Include/Exclude 판정을 덮어쓰지 않게 한다.
        const preferred = previous &&
          item.aiDecision === 'Duplicated' &&
          previous.aiDecision !== 'Duplicated'
          ? previous
          : item;
        merged.set(key, { ...preferred, searchSources });
      });
    });

  return Array.from(merged.values()).map((item, index) => ({
    ...item,
    no: index + 1,
  }));
}
