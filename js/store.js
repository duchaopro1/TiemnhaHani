// Data store: local (this browser only) or Firebase Firestore (shared, realtime).
import { firebaseConfig, SHOP_ID } from './firebase-config.js';

export const COLLECTIONS = ['products', 'packaging', 'presets', 'imports', 'orders', 'meta'];
const LOCAL_KEY = 'hani-data-v1';
const FB = 'https://www.gstatic.com/firebasejs/10.12.2';

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 20);

const emptyState = () => Object.fromEntries(COLLECTIONS.map((c) => [c, []]));

class BaseStore {
  constructor() {
    this.data = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()]));
    this.listeners = new Set();
    this.pending = 0; // writes sent and not yet confirmed
    this.lastError = null;
    this.statusListeners = new Set();
    this.loaded = new Set();
    this.readyWaiters = [];
  }
  get state() {
    return Object.fromEntries(COLLECTIONS.map((c) => [c, [...this.data[c].values()]]));
  }
  get(coll, id) {
    return this.data[coll].get(id);
  }
  onChange(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  emit() {
    for (const cb of this.listeners) cb();
  }
  /** Called when the number of unconfirmed writes or the last save error changes. */
  onStatus(cb) {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }
  emitStatus() {
    for (const cb of this.statusListeners) cb({ pending: this.pending, error: this.lastError });
  }
  /** Follow a write: counts as pending until it resolves; remembers a failure until the next success. */
  track(promise) {
    this.pending += 1;
    this.emitStatus();
    return promise.then(
      (v) => { this.pending -= 1; this.lastError = null; this.emitStatus(); return v; },
      (e) => { this.pending -= 1; this.lastError = e; this.emitStatus(); throw e; },
    );
  }
  markLoaded(coll) {
    this.loaded.add(coll);
    if (this.loaded.size >= COLLECTIONS.length) this.readyWaiters.splice(0).forEach((resolve) => resolve());
  }
  /** Resolves once every collection has delivered its first data (or after `timeout` ms). */
  whenReady(timeout = 6000) {
    if (this.loaded.size >= COLLECTIONS.length) return Promise.resolve();
    return new Promise((resolve) => { this.readyWaiters.push(resolve); setTimeout(resolve, timeout); });
  }
}

class LocalStore extends BaseStore {
  mode = 'local';
  async init() {
    let raw = emptyState();
    try {
      raw = { ...raw, ...JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}') };
    } catch { /* corrupted or blocked storage: start empty */ }
    for (const c of COLLECTIONS) for (const doc of raw[c] || []) this.data[c].set(doc.id, doc);
    COLLECTIONS.forEach((c) => this.markLoaded(c));
    this.emit();
  }
  persist() {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(this.state));
    } catch (e) {
      this.onError?.({ code: 'local', message: 'Không lưu được dữ liệu vào trình duyệt: ' + e.message });
    }
  }
  async upsert(coll, doc) {
    doc.id ||= uid();
    doc.updatedAt = Date.now();
    this.data[coll].set(doc.id, doc);
    this.persist();
    this.emit();
    return doc;
  }
  async upsertMany(coll, docs) {
    for (const doc of docs) {
      doc.id ||= uid();
      doc.updatedAt = Date.now();
      this.data[coll].set(doc.id, doc);
    }
    this.persist();
    this.emit();
  }
  async remove(coll, id) {
    this.data[coll].delete(id);
    this.persist();
    this.emit();
  }
}

class FirebaseStore extends BaseStore {
  mode = 'firebase';
  async init(onAuth) {
    const [{ initializeApp }, fs, auth] = await Promise.all([
      import(`${FB}/firebase-app.js`),
      import(`${FB}/firebase-firestore.js`),
      import(`${FB}/firebase-auth.js`),
    ]);
    this.fs = fs;
    this.authLib = auth;
    const app = initializeApp(firebaseConfig);
    this.db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
    this.auth = auth.getAuth(app);
    this.unsubs = [];
    auth.onAuthStateChanged(this.auth, (user) => {
      this.user = user;
      this.unsubs.forEach((u) => u());
      this.unsubs = [];
      if (user) this.subscribe();
      onAuth(user);
    });
  }
  col(coll) {
    return this.fs.collection(this.db, 'shops', SHOP_ID, coll);
  }
  subscribe() {
    for (const c of COLLECTIONS) {
      const unsub = this.fs.onSnapshot(
        this.col(c),
        (snap) => {
          this.data[c] = new Map(snap.docs.map((d) => [d.id, { ...d.data(), id: d.id }]));
          this.markLoaded(c);
          this.emit();
        },
        (err) => this.onError?.(err),
      );
      this.unsubs.push(unsub);
    }
  }
  signIn() {
    return this.authLib.signInWithPopup(this.auth, new this.authLib.GoogleAuthProvider());
  }
  signOut() {
    return this.authLib.signOut(this.auth);
  }
  clean(doc) {
    // Firestore rejects `undefined` values.
    return JSON.parse(JSON.stringify(doc));
  }
  async upsert(coll, doc) {
    doc.id ||= uid();
    doc.updatedAt = Date.now();
    doc.updatedBy = this.user?.email || '';
    await this.track(this.fs.setDoc(this.fs.doc(this.col(coll), doc.id), this.clean(doc)));
    return doc;
  }
  async upsertMany(coll, docs) {
    // Firestore batches are limited to 500 writes.
    for (let i = 0; i < docs.length; i += 400) {
      const batch = this.fs.writeBatch(this.db);
      for (const doc of docs.slice(i, i + 400)) {
        doc.id ||= uid();
        doc.updatedAt = Date.now();
        doc.updatedBy = this.user?.email || '';
        batch.set(this.fs.doc(this.col(coll), doc.id), this.clean(doc));
      }
      await this.track(batch.commit());
    }
  }
  async remove(coll, id) {
    await this.track(this.fs.deleteDoc(this.fs.doc(this.col(coll), id)));
  }
}

// Shared store of a Claude artifact page (the `db` capability): realtime, kept server-side,
// shared by everyone the page is shared with.
class ArtifactStore extends BaseStore {
  mode = 'artifact';
  constructor(db) {
    super();
    this.db = db;
  }
  async init() {
    for (const c of COLLECTIONS) {
      this.db.collection(c).onSnapshot(
        (snap) => {
          this.data[c] = new Map(snap.docs.map((d) => [d.id, { ...d.data(), id: d.id }]));
          this.markLoaded(c);
          this.emit();
        },
        (err) => this.onError?.(err),
      );
    }
  }
  /** Run a platform call; a dropped connection (`unavailable`) is retried once after a short pause. */
  async send(fn) {
    try {
      return await fn();
    } catch (err) {
      if (err?.code !== 'unavailable') throw err;
      await new Promise((resolve) => setTimeout(resolve, 400 + Math.random() * 500));
      return fn();
    }
  }
  async write(coll, doc) {
    doc.id ||= uid();
    doc.updatedAt = Date.now();
    const body = JSON.parse(JSON.stringify(doc));
    const before = this.data[coll].get(doc.id);
    this.data[coll].set(doc.id, body); // show it right away; the snapshot confirms it
    try {
      await this.track(this.send(() => this.db.collection(coll).doc(doc.id).set(body)));
    } catch (err) {
      // The server did not take it: don't leave an order on screen that was never saved.
      if (before) this.data[coll].set(doc.id, before); else this.data[coll].delete(doc.id);
      this.emit();
      this.onError?.(err);
      throw err;
    }
    return doc;
  }
  async upsert(coll, doc) {
    const out = await this.write(coll, doc);
    this.emit();
    return out;
  }
  async upsertMany(coll, docs) {
    // A few writes in flight at a time keeps big Shopee imports quick without hitting rate limits.
    const queue = [...docs];
    const worker = async () => { while (queue.length) await this.write(coll, queue.shift()); };
    await Promise.all(Array.from({ length: 4 }, worker));
    this.emit();
  }
  async remove(coll, id) {
    const before = this.data[coll].get(id);
    this.data[coll].delete(id);
    this.emit();
    try {
      await this.track(this.send(() => this.db.collection(coll).doc(id).delete()));
    } catch (err) {
      if (before) this.data[coll].set(id, before);
      this.emit();
      this.onError?.(err);
      throw err;
    }
  }
}

export const firebaseEnabled = Boolean(firebaseConfig && firebaseConfig.apiKey);

// Picked by initStore(): Firebase when configured, the artifact's shared db when the
// page runs as a Claude artifact, otherwise this browser's localStorage.
export let store;

export async function initStore() {
  if (firebaseEnabled) {
    store = new FirebaseStore();
  } else {
    let db = null;
    try {
      db = window.claude?.use ? await window.claude.use('db') : null;
    } catch { /* not served here */ }
    store = db ? new ArtifactStore(db) : new LocalStore();
  }
  return store;
}

/** Replace all data with a backup (JSON exported from Cài đặt). */
export async function restoreBackup(backup) {
  for (const c of COLLECTIONS) {
    for (const id of [...store.data[c].keys()]) await store.remove(c, id);
    if (backup[c]?.length) await store.upsertMany(c, backup[c].map((d) => ({ ...d })));
  }
}
