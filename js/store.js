// Data store: local (this browser only) or Firebase Firestore (shared, realtime).
import { firebaseConfig, SHOP_ID } from './firebase-config.js';

export const COLLECTIONS = ['products', 'packaging', 'presets', 'imports', 'orders', 'meta'];
const LOCAL_KEY = 'hani-data-v1';
const FB = 'https://www.gstatic.com/firebasejs/10.12.2';
const POLL_MS = 30000; // how long a quiet page waits before asking the server again

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
    this.lastSync = 0; // when data last arrived from the server
    this.connected = true; // false while a live listener is down and being reconnected
    this.refreshing = false;
    this.liveListeners = new Set();
    this.onRemote = null; // (collection, docs) when another person adds documents
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
  /** Called when the freshness info changes: last update time, connected or not, refreshing now. */
  onLive(cb) {
    this.liveListeners.add(cb);
    return () => this.liveListeners.delete(cb);
  }
  liveInfo() {
    return { lastSync: this.lastSync, connected: this.connected, refreshing: this.refreshing };
  }
  emitLive() {
    for (const cb of this.liveListeners) cb(this.liveInfo());
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
    this.unsubs = {};
    this.attempts = {};
    this.dead = new Set(); // collections whose live listener ended
    this.writeSeq = 0;
    this.lastRefreshAt = 0;
  }
  async init() {
    COLLECTIONS.forEach((c) => this.listen(c));
    // The live stream can fail quietly, or sleep while the tab is in the background. Ask the server
    // again whenever the page comes back, and now and then while it is open.
    const wake = () => {
      if (document.visibilityState !== 'visible') return;
      [...this.dead].forEach((c) => { this.attempts[c] = 0; this.listen(c); });
      this.refresh();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    const every = Number(globalThis.__HANI_POLL_MS) || POLL_MS;
    setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - this.lastSync >= every) this.refresh();
    }, Math.max(1000, Math.min(5000, every / 2)));
  }
  /** (Re)start the live listener of one collection. A dead listener is replaced, never left dead. */
  listen(c) {
    this.unsubs[c]?.();
    this.unsubs[c] = this.db.collection(c).onSnapshot(
      (snap) => {
        this.attempts[c] = 0;
        if (this.dead.delete(c) && !this.dead.size) this.setConnected(true);
        this.apply(c, snap.docs);
      },
      (err) => this.listenFailed(c, err),
    );
  }
  listenFailed(c, err) {
    this.unsubs[c] = null;
    if (err?.code === 'revoked') { this.onLiveError?.(err); return; } // access withdrawn: nothing to retry
    this.dead.add(c);
    this.setConnected(false);
    const n = (this.attempts[c] = (this.attempts[c] || 0) + 1);
    if (n > 10) return; // the periodic refresh still keeps the page current
    setTimeout(() => { if (this.dead.has(c)) this.listen(c); }, Math.min(30000, 1000 * 2 ** (n - 1)));
  }
  setConnected(v) {
    if (this.connected === v) return;
    this.connected = v;
    this.emitLive();
  }
  /** Take a fresh copy of one collection; tell the page when other people added documents. */
  apply(c, docs) {
    const prev = this.data[c];
    const first = !this.loaded.has(c);
    const next = new Map(docs.map((d) => [d.id, { ...d.data(), id: d.id }]));
    this.data[c] = next;
    this.lastSync = Date.now();
    this.markLoaded(c);
    if (!first && c === 'orders') {
      const added = [...next.values()].filter((o) => !prev.has(o.id));
      if (added.length) this.onRemote?.(c, added);
    }
    this.emit();
    this.emitLive();
  }
  /**
   * Ask the server for everything now. Skipped while a save is in flight (an older copy would make the
   * order being saved vanish for a moment). Returns whether it ran.
   */
  async refresh({ manual = false } = {}) {
    if (this.refreshing || this.pending > 0) return false;
    if (!manual && Date.now() - this.lastRefreshAt < 2000) return false;
    this.refreshing = true;
    this.lastRefreshAt = Date.now();
    this.emitLive();
    try {
      for (const c of COLLECTIONS) {
        const seq = this.writeSeq;
        const snap = await this.db.collection(c).get();
        if (this.pending > 0 || this.writeSeq !== seq) return false; // a save started meanwhile
        this.apply(c, snap.docs);
      }
      return true;
    } catch {
      return false; // the live listeners and the next round try again
    } finally {
      this.refreshing = false;
      this.emitLive();
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
    this.writeSeq += 1;
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
    this.writeSeq += 1;
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
