// Gives the app the same small database interface it used inside claude.ai (window.claude.use('db')),
// backed by Firebase Firestore + Firebase Auth. Data is already encrypted in the app before it gets here.
import { initializeApp } from 'firebase/app';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut as fbSignOut, deleteUser as fbDeleteUser, updatePassword as fbUpdatePassword
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentSingleTabManager, memoryLocalCache,
  doc, collection, getDoc, getDocs, getDocsFromCache, setDoc, deleteDoc, query, where, onSnapshot
} from 'firebase/firestore';
// Second, independent route to the same database: plain HTTPS requests, no realtime channel and no
// on-device cache. Used when the realtime connection does not answer.
import * as L from 'firebase/firestore/lite';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
import { HealthConnect } from 'capacitor-health-connect';
import { LocalNotifications } from '@capacitor/local-notifications';
import cfg from './firebase-config.js';

// After an app update: sign out and wipe this device's saved database copy, so the first launch of a
// new version always starts from the sign-in screen with a clean slate. Runs before Firebase opens anything.
let UPDATED = false;
try {
  const cur = String(window.LEGACY_VERSION || ''), prev = localStorage.getItem('legacy_app_ver');
  if (cur && prev !== cur) {
    UPDATED = true;
    ['legacy_session', 'legacy_nocache'].forEach(k => localStorage.removeItem(k));
    ['firebaseLocalStorageDb', 'firestore/[DEFAULT]/' + cfg.projectId + '/main'].forEach(n => { try { indexedDB.deleteDatabase(n) } catch (e) {} });
    localStorage.setItem('legacy_app_ver', cur);
  }
} catch (e) {}
const app = initializeApp(cfg);
let NOCACHE = false;
try { NOCACHE = localStorage.getItem('legacy_nocache') === '1'; } catch (e) {}
let fs;
try {
  fs = initializeFirestore(app, {
    localCache: NOCACHE ? memoryLocalCache() : persistentLocalCache({ tabManager: persistentSingleTabManager(undefined) }),
    experimentalAutoDetectLongPolling: true
  });
} catch (e) {
  console.error('firestore init', e); NOCACHE = true;
  fs = initializeFirestore(app, { localCache: memoryLocalCache(), experimentalAutoDetectLongPolling: true });
}
const lfs = L.getFirestore(app);
let MODE = 'full'; // 'lite' once the realtime route has proven stuck on this launch
const timeout = (p, ms, tag) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error(tag + ' timed out'), { code: 'timeout' })), ms))]);
const auth = getAuth(app);

// usernames become hidden emails, so nobody has to use a real one
const hex = s => Array.from(new TextEncoder().encode(s)).map(b => b.toString(16).padStart(2, '0')).join('');
const emailOf = u => hex(u) + '@legacy.invalid';
const uid = () => (auth.currentUser ? auth.currentUser.uid : null);

const wrapDoc = d => ({ id: d.id, exists: d.exists(), data: () => d.data() });
const missing = path => ({ id: path, exists: false, data: () => undefined });
const docRef = path => ({
  async get() {
    const viaLite = async () => { try { return wrapDoc(await L.getDoc(L.doc(lfs, path))) } catch (e) { if (e && e.code === 'permission-denied') return missing(path); throw e } };
    if (MODE === 'lite') return viaLite();
    try { return wrapDoc(await timeout(getDoc(doc(fs, path)), 9000, 'read')) }
    catch (e) {
      if (e && e.code === 'permission-denied') return missing(path);
      if (e && (e.code === 'timeout' || e.code === 'unavailable')) return viaLite();
      throw e;
    }
  },
  async set(v) {
    const data = Object.assign({}, v, { o: uid() });
    if (MODE === 'lite') return L.setDoc(L.doc(lfs, path), data);
    // the realtime route keeps the write queued; if it has not been confirmed in 10s, send it directly too
    try { await timeout(setDoc(doc(fs, path), data), 10000, 'save') }
    catch (e) { if (e && e.code === 'timeout') await L.setDoc(L.doc(lfs, path), data); else throw e }
  },
  async delete() {
    if (MODE === 'lite') return L.deleteDoc(L.doc(lfs, path));
    try { await timeout(deleteDoc(doc(fs, path)), 10000, 'delete') }
    catch (e) { if (e && e.code === 'timeout') await L.deleteDoc(L.doc(lfs, path)); else throw e }
  }
});
const colRef = (path, filt) => {
  const fq = () => filt ? query(collection(fs, path), ...filt.map(a => where(...a))) : collection(fs, path);
  const lq = () => filt ? L.query(L.collection(lfs, path), ...filt.map(a => L.where(...a))) : L.collection(lfs, path);
  return {
    doc: id => docRef(path + '/' + id),
    async get() { const s = await getDocs(fq()); return { docs: s.docs.map(wrapDoc) } },
    // direct HTTPS read, skips the realtime channel and the device cache
    async getDirect() { const s = await L.getDocs(lq()); return { docs: s.docs.map(wrapDoc), source: 'server-direct' } },
    async getCached() { const s = await getDocsFromCache(fq()); return { docs: s.docs.map(wrapDoc), source: 'cache', fromCache: true } },
    where(f, op, v) { return colRef(path, [[f, op, v], ['o', '==', uid()]]) },
    onSnapshot(cb, err) { return onSnapshot(fq(), s => cb({ docs: s.docs.map(wrapDoc), fromCache: s.metadata.fromCache, source: s.metadata.fromCache ? 'live-cache' : 'live' }), err) }
  };
};
const db = {
  collection: p => colRef(p),
  doc: p => docRef(p),
  setMode: m => { MODE = m === 'lite' ? 'lite' : 'full' },
  updated: () => UPDATED,
  info: () => ({ mode: MODE, cache: NOCACHE ? 'memory' : 'device', online: navigator.onLine, uid: !!uid(), adapter: 3 }),
  async resetCache() {
    try { localStorage.setItem('legacy_nocache', '1') } catch (e) {}
    try {
      const names = indexedDB.databases ? (await indexedDB.databases()).map(d => d.name) : [];
      names.filter(n => n && /firestore/i.test(n)).forEach(n => { try { indexedDB.deleteDatabase(n) } catch (e) {} });
    } catch (e) {}
  },
  useCacheAgain() { try { localStorage.removeItem('legacy_nocache') } catch (e) {} },
  auth: {
    ready: () => auth.authStateReady(),
    uid,
    is: u => !!auth.currentUser && auth.currentUser.email === emailOf(u),
    signUp: (u, p) => createUserWithEmailAndPassword(auth, emailOf(u), p),
    signIn: (u, p) => signInWithEmailAndPassword(auth, emailOf(u), p),
    setPassword: p => (auth.currentUser ? fbUpdatePassword(auth.currentUser, p) : Promise.reject(new Error('not signed in'))),
    signOut: () => fbSignOut(auth),
    deleteUser: () => (auth.currentUser ? fbDeleteUser(auth.currentUser) : Promise.resolve())
  }
};
const user = { id: async () => null };

window.claude = { use: async name => (name === 'db' ? db : name === 'user' ? user : null) };

// Android-only extras. In a normal browser window.LegacyNative stays undefined.
if (Capacitor.isNativePlatform()) {
  const IDS = [0, 1, 2, 3, 4, 5, 6].map(d => 201 + d);
  const WorkoutNotif = registerPlugin('WorkoutNotif');
  const HC_READ = ['Steps', 'HeartRateSeries', 'SleepSession', 'ActiveCaloriesBurned'];
  const dk = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  let notifAsked = false;

  WorkoutNotif.addListener('action', e => { try { window.LegacyAction && window.LegacyAction(e.a); } catch (x) { console.error(x); } });
  App.addListener('backButton', () => { let h = false; try { h = window.LegacyBack && window.LegacyBack(); } catch (x) {} if (!h) App.exitApp(); });
  App.addListener('appUrlOpen', e => { try { window.LegacyDeepLink && window.LegacyDeepLink(e.url); } catch (x) {} });
  App.getLaunchUrl().then(r => { if (r && r.url) { const t = setInterval(() => { if (window.LegacyDeepLink) { clearInterval(t); window.LegacyDeepLink(r.url); } }, 300); setTimeout(() => clearInterval(t), 8000); } }).catch(() => {});

  async function readAll(type, from, to) {
    let out = [], token;
    for (let i = 0; i < 6; i++) {
      const r = await HealthConnect.readRecords({ type, timeRangeFilter: { type: 'between', startTime: from, endTime: to }, pageSize: 1000, pageToken: token });
      out = out.concat(r.records || []);
      token = r.pageToken; if (!token) break;
    }
    return out;
  }

  window.LegacyNative = {
    async setReminders(o) {
      try {
        await LocalNotifications.cancel({ notifications: IDS.map(id => ({ id })) });
        if (!o.on) return { ok: true };
        let p = await LocalNotifications.checkPermissions();
        if (p.display !== 'granted') p = await LocalNotifications.requestPermissions();
        if (p.display !== 'granted') return { ok: false, reason: 'denied' };
        await LocalNotifications.schedule({
          notifications: o.days.map(d => ({
            id: 201 + d, title: o.title, body: o.body,
            schedule: { on: { weekday: d + 1, hour: o.hour, minute: o.min } }
          }))
        });
        return { ok: true };
      } catch (e) { console.error(e); return { ok: false, reason: 'error' }; }
    },

    async setRestNotif(o) {
      try {
        if (!notifAsked) { notifAsked = true; const p = await LocalNotifications.checkPermissions(); if (p.display !== 'granted') await LocalNotifications.requestPermissions(); }
        await WorkoutNotif.show(o);
      } catch (e) { console.error(e); }
    },
    async clearRestNotif() { try { await WorkoutNotif.hide(); } catch (e) {} },

    async scanBarcode() {
      const mod = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
      if (!mod.available) {
        await new Promise(async (res, rej) => {
          const h = await BarcodeScanner.addListener('googleBarcodeScannerModuleInstallProgress', ev => { if (ev.state === 4) { h.remove(); res(); } else if (ev.state === 3 || ev.state === 5) { h.remove(); rej(new Error('install')); } });
          await BarcodeScanner.installGoogleBarcodeScannerModule();
          setTimeout(() => { h.remove(); rej(new Error('timeout')); }, 90000);
        });
      }
      const r = await BarcodeScanner.scan({ formats: [BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.UpcA, BarcodeFormat.UpcE] });
      return r.barcodes && r.barcodes[0] ? r.barcodes[0].rawValue : null;
    },

    async shareImage(b64, name, title) {
      const f = await Filesystem.writeFile({ path: name, data: b64, directory: Directory.Cache });
      await Share.share({ title, files: [f.uri], dialogTitle: title });
    },

    async hcStatus() {
      const a = await HealthConnect.checkAvailability();
      if (a.availability !== 'Available') return { available: false, granted: false };
      const p = await HealthConnect.checkHealthPermissions({ read: HC_READ, write: [] });
      return { available: true, granted: !!p.hasAllPermissions };
    },
    async hcRequest() {
      const p = await HealthConnect.requestHealthPermissions({ read: HC_READ, write: [] });
      return !!p.hasAllPermissions;
    },
    async hcRead(n) {
      const to = new Date(), from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - (n - 1));
      const days = {}, D = t => days[dk(t)] || (days[dk(t)] = { steps: 0, kcal: 0, hrSum: 0, hrN: 0, sleepMin: 0 });
      const safe = async (type, from2, fn) => { try { (await readAll(type, from2, to)).forEach(fn); } catch (e) { console.warn('hc ' + type, e); } };
      await safe('Steps', from, r => { D(r.startTime).steps += r.count || 0; });
      await safe('ActiveCaloriesBurned', from, r => { const e = r.energy; if (e) D(r.startTime).kcal += e.unit === 'kilocalories' ? e.value : e.unit === 'calories' ? e.value / 1000 : e.unit === 'kilojoules' ? e.value / 4.184 : e.value / 4184; });
      const hrFrom = new Date(to.getTime() - 3 * 864e5);
      await safe('HeartRateSeries', hrFrom, r => { (r.samples || []).forEach(s => { const d = D(s.time || r.startTime); d.hrSum += s.beatsPerMinute; d.hrN++; }); });
      await safe('SleepSession', from, r => { D(r.endTime).sleepMin += Math.max(0, (new Date(r.endTime) - new Date(r.startTime)) / 60000); });
      Object.values(days).forEach(d => { d.hr = d.hrN ? d.hrSum / d.hrN : 0; delete d.hrSum; delete d.hrN; });
      return { days };
    }
  };
}
