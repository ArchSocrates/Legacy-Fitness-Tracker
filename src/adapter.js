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
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
import { HealthConnect } from 'capacitor-health-connect';
import { LocalNotifications } from '@capacitor/local-notifications';
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
    uid,
    is: u => !!auth.currentUser && auth.currentUser.email === emailOf(u),
    signUp: (u, p) => createUserWithEmailAndPassword(auth, emailOf(u), p),
    signIn: (u, p) => signInWithEmailAndPassword(auth, emailOf(u), p),
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
