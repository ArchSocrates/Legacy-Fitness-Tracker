// Gives the app the same small database interface it used inside claude.ai (window.claude.use('db')),
// but backed by Firebase Firestore. All data is already encrypted in the app before it gets here.
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, getDoc, getDocs, setDoc, deleteDoc, query, where, onSnapshot
} from 'firebase/firestore';
import cfg from './firebase-config.js';

const app = initializeApp(cfg);
const fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
const auth = getAuth(app);
let authP = null;
const ready = () => (authP ||= signInAnonymously(auth).catch(e => { authP = null; throw e }));

const wrapDoc = d => ({ id: d.id, exists: d.exists(), data: () => d.data() });
const docRef = (path) => ({
  async get() { await ready(); return wrapDoc(await getDoc(doc(fs, path))) },
  async set(v) { await ready(); await setDoc(doc(fs, path), v) },
  async delete() { await ready(); await deleteDoc(doc(fs, path)) }
});
const colRef = (path, q) => ({
  doc: id => docRef(path + '/' + id),
  async get() { await ready(); const s = await getDocs(q || collection(fs, path)); return { docs: s.docs.map(wrapDoc) } },
  where(f, op, v) { return colRef(path, query(collection(fs, path), where(f, op, v))) },
  onSnapshot(cb, err) {
    let un = () => {}, dead = false;
    ready().then(() => { if (!dead) un = onSnapshot(q || collection(fs, path), s => cb({ docs: s.docs.map(wrapDoc) }), err) }, e => err && err(e));
    return () => { dead = true; un() };
  }
});
const db = { collection: p => colRef(p), doc: p => docRef(p) };
const user = { id: async () => null };

window.claude = { use: async name => (name === 'db' ? db : name === 'user' ? user : null) };
