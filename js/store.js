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
}

class LocalStore extends BaseStore {
  mode = 'local';
  async init() {
    let raw = emptyState();
    try {
      raw = { ...raw, ...JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}') };
    } catch { /* corrupted or blocked storage: start empty */ }
    for (const c of COLLECTIONS) for (const doc of raw[c] || []) this.data[c].set(doc.id, doc);
    this.emit();
  }
  persist() {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(this.state));
    } catch (e) {
      alert('Không lưu được dữ liệu vào trình duyệt: ' + e.message);
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
    await this.fs.setDoc(this.fs.doc(this.col(coll), doc.id), this.clean(doc));
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
      await batch.commit();
    }
  }
  async remove(coll, id) {
    await this.fs.deleteDoc(this.fs.doc(this.col(coll), id));
  }
}

export const firebaseEnabled = Boolean(firebaseConfig && firebaseConfig.apiKey);
export const store = firebaseEnabled ? new FirebaseStore() : new LocalStore();

/** Replace all data with a backup (JSON exported from Cài đặt). */
export async function restoreBackup(backup) {
  for (const c of COLLECTIONS) {
    for (const id of [...store.data[c].keys()]) await store.remove(c, id);
    if (backup[c]?.length) await store.upsertMany(c, backup[c].map((d) => ({ ...d })));
  }
}
