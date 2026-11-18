// Gives the app the same small database interface it used inside claude.ai (window.claude.use('db')),
// backed by Firebase Firestore + Firebase Auth. Data is already encrypted in the app before it gets here.
import { initializeApp } from 'firebase/app';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut as fbSignOut, deleteUser as fbDeleteUser
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, getDoc, getDocs, setDoc, deleteDoc, query, where, onSnapshot
} from 'firebase/firestore';
import cfg from './firebase-config.js';

const app = initializeApp(cfg);
const fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
const auth = getAuth(app);

// usernames become hidden emails, so nobody has to use a real one
const hex = s => Array.from(new TextEncoder().encode(s)).map(b => b.toString(16).padStart(2, '0')).join('');
const emailOf = u => hex(u) + '@legacy.invalid';
const uid = () => (auth.currentUser ? auth.currentUser.uid : null);

const wrapDoc = d => ({ id: d.id, exists: d.exists(), data: () => d.data() });
const docRef = path => ({
  async get() {
    try { return wrapDoc(await getDoc(doc(fs, path))) }
    catch (e) { if (e && e.code === 'permission-denied') return { id: path, exists: false, data: () => undefined }; throw e }
  },
  async set(v) { await setDoc(doc(fs, path), Object.assign({}, v, { o: uid() })) },
  async delete() { await deleteDoc(doc(fs, path)) }
});
const colRef = (path, q) => ({
  doc: id => docRef(path + '/' + id),
  async get() { const s = await getDocs(q || collection(fs, path)); return { docs: s.docs.map(wrapDoc) } },
  where(f, op, v) { return colRef(path, query(collection(fs, path), where(f, op, v), where('o', '==', uid()))) },
  onSnapshot(cb, err) { return onSnapshot(q || collection(fs, path), s => cb({ docs: s.docs.map(wrapDoc) }), err) }
});
const db = {
  collection: p => colRef(p),
  doc: p => docRef(p),
  auth: {
    ready: () => auth.authStateReady(),
    is: u => !!auth.currentUser && auth.currentUser.email === emailOf(u),
    signUp: (u, p) => createUserWithEmailAndPassword(auth, emailOf(u), p),
    signIn: (u, p) => signInWithEmailAndPassword(auth, emailOf(u), p),
    signOut: () => fbSignOut(auth),
    deleteUser: () => (auth.currentUser ? fbDeleteUser(auth.currentUser) : Promise.resolve())
  }
};
const user = { id: async () => null };

window.claude = { use: async name => (name === 'db' ? db : name === 'user' ? user : null) };
