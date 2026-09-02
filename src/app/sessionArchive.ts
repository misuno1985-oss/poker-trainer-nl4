/**
 * Архив последних сессий.
 *
 * Хранит ПОЛНУЮ выгрузку, а не её краткое изложение: через три дня должно быть
 * можно открыть тренажёр, выбрать сессию и получить тот же самый файл, что
 * скачался бы сразу после игры.
 *
 * Поэтому не localStorage: полная выгрузка десятка раздач — это около мегабайта,
 * и в localStorage такое класть нельзя. IndexedDB держит столько без труда и
 * переживает перезагрузку и закрытие браузера.
 *
 * Порядок записи важен: сначала гарантированно сохраняем новую сессию и только
 * потом удаляем самую старую. Иначе редкий сбой оставил бы игрока и без старой
 * записи, и без новой.
 */

const DB_NAME = 'nl4-trainer';
const DB_VERSION = 1;
const STORE = 'sessions';

/** Сколько сессий держим. Шестая вытесняет самую старую. */
export const ARCHIVE_LIMIT = 5;

/** Короткая строка для списка: её видно, не открывая саму выгрузку. */
export interface ArchiveMeta {
  id: string;
  endedAt: number;
  mode: string;
  modeDetail: string | null;
  hands: number;
  decisionScore: number;
  netCents: number;
  majorMistakes: number;
  focus: string | null;
  fileName: string;
}

export interface ArchiveRecord extends ArchiveMeta {
  /** Та же самая выгрузка, что уходит в файл. */
  payload: unknown;
}

/* ------------------------------------------------------------------ */
/* Обёртки над IndexedDB                                               */
/* ------------------------------------------------------------------ */

function hasDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        // Список всегда показывается свежими сверху — сортируем по времени.
        store.createIndex('endedAt', 'endedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function ask<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ------------------------------------------------------------------ */
/* Что делает архив                                                    */
/* ------------------------------------------------------------------ */

/** Список сессий, свежие сверху. Без выгрузок — только строки для списка. */
export async function listSessions(): Promise<ArchiveMeta[]> {
  if (!hasDb()) return [];
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const all = await ask(tx.objectStore(STORE).getAll() as IDBRequest<ArchiveRecord[]>);
    db.close();
    return all
      .map(({ payload, ...meta }) => { void payload; return meta; })
      .sort((a, b) => b.endedAt - a.endedAt);
  } catch {
    // Хранилище недоступно — список просто пуст, играть это не мешает.
    return [];
  }
}

/** Полная выгрузка одной сессии. */
export async function loadSession(id: string): Promise<unknown | null> {
  if (!hasDb()) return null;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const record = await ask(tx.objectStore(STORE).get(id) as IDBRequest<ArchiveRecord | undefined>);
    db.close();
    return record ? record.payload : null;
  } catch {
    return null;
  }
}

export interface SaveResult {
  ok: boolean;
  /** Сколько сессий осталось в архиве. */
  kept: number;
  /** Понятное объяснение, если сохранить не удалось. */
  error?: string;
}

/**
 * Сохранить завершённую сессию.
 *
 * Сначала запись, потом вытеснение старых — и только если запись удалась.
 * Ошибка здесь не должна ломать ни текущую раздачу, ни само приложение:
 * выгрузка «прямо сейчас» работает из памяти и от архива не зависит.
 */
export async function saveSession(record: ArchiveRecord): Promise<SaveResult> {
  if (!hasDb()) return { ok: false, kept: 0, error: 'В этом браузере нет хранилища для архива.' };

  let db: IDBDatabase | null = null;
  try {
    db = await openDb();

    // 1. Сначала новая запись — отдельной транзакцией, которая должна завершиться.
    const write = db.transaction(STORE, 'readwrite');
    write.objectStore(STORE).put(record);
    await done(write);

    // 2. И только теперь убираем лишние, от самых старых.
    const trim = db.transaction(STORE, 'readwrite');
    const store = trim.objectStore(STORE);
    const all = await ask(store.getAll() as IDBRequest<ArchiveRecord[]>);
    const byAge = [...all].sort((a, b) => b.endedAt - a.endedAt);
    for (const old of byAge.slice(ARCHIVE_LIMIT)) store.delete(old.id);
    await done(trim);

    db.close();
    return { ok: true, kept: Math.min(byAge.length, ARCHIVE_LIMIT) };
  } catch (e) {
    try { db?.close(); } catch { /* уже закрыта */ }
    const quota = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'AbortError');
    return {
      ok: false,
      kept: 0,
      error: quota
        ? 'В браузере кончилось место — сессия не попала в архив.'
        : 'Не удалось сохранить сессию в архив.',
    };
  }
}

/** Убрать всё. Нужно, когда игрок сбрасывает статистику. */
export async function clearSessions(): Promise<void> {
  if (!hasDb()) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await done(tx);
    db.close();
  } catch {
    // Не удалось — не беда.
  }
}

/**
 * Какие записи останутся после сохранения новой.
 * Вынесено отдельно, чтобы правило вытеснения проверялось без базы.
 */
export function keepNewest<T extends { id: string; endedAt: number }>(
  existing: readonly T[],
  incoming: T,
  limit = ARCHIVE_LIMIT,
): T[] {
  const merged = existing.filter((r) => r.id !== incoming.id).concat(incoming);
  return merged.sort((a, b) => b.endedAt - a.endedAt).slice(0, limit);
}
