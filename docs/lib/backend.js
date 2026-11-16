// Where the web shop gets its products from and where an order goes.
// With Firebase configured (docs/config.js): products and stock are read live from the database the admin app
// keeps up to date, and an order is written into it. Without: catalog.json, and the order is only a chat message.
import { firebaseConfig, SHOP_ID } from '../config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2';
export const live = Boolean(firebaseConfig.apiKey);

/** Put the shop's documents together into the catalog the page draws: categories in the shop's own order. */
export function assembleCatalog(info, productDocs) {
  const categories = Array.isArray(info?.categories) ? info.categories : [];
  const rank = (c) => { const i = categories.indexOf(c); return i < 0 ? 999 : i; };
  const products = productDocs
    .map(({ _h, ...p }) => p)
    .sort((a, b) => rank(a.category) - rank(b.category) || String(a.name).localeCompare(String(b.name), 'vi'));
  const { categories: _c, updatedAt, _h, ...shop } = info || {};
  return { version: 1, updatedAt: updatedAt || '', shop: { name: 'Hani', welcome: '', instagram: '', threads: '', shipFlat: 15000, ...shop }, categories, products };
}

let ready = null;
function open() {
  ready ||= (async () => {
    const [{ initializeApp }, fs] = await Promise.all([import(`${FB}/firebase-app.js`), import(`${FB}/firebase-firestore.js`)]);
    return { fs, db: fs.getFirestore(initializeApp(firebaseConfig)) };
  })();
  return ready;
}

/** Call `onData(catalog)` now and every time the shop's products or stock change. Resolves to a stop function. */
export async function watchCatalog(onData, onError) {
  const { fs, db } = await open();
  const col = (n) => fs.collection(db, 'shops', SHOP_ID, n);
  let info = null, docs = null;
  const push = () => { if (info !== undefined && docs) onData(assembleCatalog(info, docs)); };
  const stops = [
    fs.onSnapshot(fs.doc(col('shopInfo'), 'main'), (d) => { info = d.exists() ? d.data() : {}; push(); }, onError),
    fs.onSnapshot(col('shopProducts'), (snap) => { docs = snap.docs.map((d) => ({ ...d.data(), id: d.id })); push(); }, onError),
  ];
  return () => stops.forEach((s) => s());
}

/** Write an order into the shop's inbox (the admin app turns it into an order). */
export async function sendOrder(order) {
  const { fs, db } = await open();
  await fs.addDoc(fs.collection(db, 'shops', SHOP_ID, 'shopOrders'), order);
}
