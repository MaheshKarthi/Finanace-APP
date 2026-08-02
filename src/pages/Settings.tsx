import { useState, useEffect } from 'react';
import { useApp, signOut } from '../context/AppContext';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { supabase, isConfigured } from '../lib/supabase';
import { pushAll, pullAll } from '../lib/sync';
import { registerPush, getPushStatus } from '../lib/push';
import { Plus, Trash2, Download, Upload, RefreshCw, LogOut, Bell, BellOff, Copy, Check, ExternalLink, Smartphone } from 'lucide-react';
import type { ImportRule } from '../db/types';

export default function Settings() {
  const { settings, updateSettings, personName, syncNow, lastSync } = useApp();
  const rules = useLiveQuery(() => db.importRules.orderBy('priority').reverse().toArray(), []);

  const [p1Name, setP1Name] = useState('');
  const [p2Name, setP2Name] = useState('');
  const [newAsset, setNewAsset] = useState('');
  const [newCat, setNewCat] = useState('');
  const [newRulePattern, setNewRulePattern] = useState('');
  const [newRuleCat, setNewRuleCat] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [webhookToken, setWebhookToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [pushStatus, setPushStatus] = useState<string>('checking');
  const [pushBusy, setPushBusy] = useState(false);
  const [userEmail, setUserEmail] = useState('');

  useEffect(() => {
    getPushStatus().then(s => setPushStatus(s));
    if (!isConfigured()) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserEmail(user.email ?? '');
    });
    supabase.from('webhook_tokens').select('token').single().then(({ data }) => {
      if (data?.token) setWebhookToken(data.token);
    });
  }, []);

  if (!settings) return <div className="p-6 text-slate-400">Loading…</div>;

  const webhookUrl = isConfigured()
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sms-webhook`
    : '(configure Supabase first)';

  // ── Handlers ───────────────────────────────────────────────────────────────
  async function saveNames() {
    if (p1Name.trim()) await updateSettings({ person1Name: p1Name.trim() });
    if (p2Name.trim()) await updateSettings({ person2Name: p2Name.trim() });
    setP1Name(''); setP2Name('');
  }

  async function addAssetClass() {
    if (!newAsset.trim() || !settings) return;
    await updateSettings({ assetClasses: [...settings.assetClasses, newAsset.trim()] });
    setNewAsset('');
  }
  async function removeAssetClass(ac: string) {
    if (!settings) return;
    await updateSettings({ assetClasses: settings.assetClasses.filter(a => a !== ac) });
  }

  async function addCategory() {
    if (!newCat.trim() || !settings) return;
    await updateSettings({ expenseCategories: [...settings.expenseCategories, newCat.trim()] });
    setNewCat('');
  }
  async function removeCategory(cat: string) {
    if (!settings) return;
    await updateSettings({ expenseCategories: settings.expenseCategories.filter(c => c !== cat) });
  }

  async function addRule() {
    if (!newRulePattern.trim() || !newRuleCat.trim()) return;
    const maxP = (rules ?? []).reduce((m, r) => Math.max(m, r.priority), 0);
    await db.importRules.add({ pattern: newRulePattern.trim(), category: newRuleCat.trim(), priority: maxP + 1 });
    setNewRulePattern(''); setNewRuleCat('');
  }
  async function deleteRule(r: ImportRule) {
    if (r.id != null) await db.importRules.delete(r.id);
  }

  async function handleSync() {
    setSyncing(true);
    await syncNow();
    setSyncing(false);
  }

  async function handlePull() {
    setSyncing(true);
    await pullAll();
    setSyncing(false);
  }

  async function handleEnablePush() {
    setPushBusy(true);
    const result = await registerPush();
    setPushStatus(result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'unavailable');
    setPushBusy(false);
  }

  async function copyWebhookUrl() {
    const full = `${webhookUrl}\n\nToken: ${webhookToken}`;
    await navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function exportData() {
    const [investments, expenses, importRulesData, holdingValues, settingsData] = await Promise.all([
      db.investments.toArray(), db.expenses.toArray(),
      db.importRules.toArray(), db.holdingValues.toArray(), db.settings.toArray(),
    ]);
    const blob = new Blob(
      [JSON.stringify({ investments, expenses, importRules: importRulesData, holdingValues, settings: settingsData }, null, 2)],
      { type: 'application/json' }
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `finance-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importData(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      setImportStatus('Importing…');
      const strip = (arr: any[]) => arr.map(({ id: _id, ...r }: any) => r);
      if (data.investments)  { await db.investments.clear();   await db.investments.bulkAdd(strip(data.investments)); }
      if (data.expenses)     { await db.expenses.clear();      await db.expenses.bulkAdd(strip(data.expenses)); }
      if (data.importRules)  { await db.importRules.clear();   await db.importRules.bulkAdd(strip(data.importRules)); }
      if (data.holdingValues){ await db.holdingValues.clear(); await db.holdingValues.bulkAdd(strip(data.holdingValues)); }
      if (data.settings?.[0]){ const { id: _id, ...s } = data.settings[0]; const ex = await db.settings.toCollection().first(); if (ex?.id) await db.settings.update(ex.id, s); }
      await pushAll();
      setImportStatus('✓ Import successful!');
    } catch { setImportStatus('✗ Import failed — invalid file'); }
    setTimeout(() => setImportStatus(''), 3000);
    e.target.value = '';
  }

  return (
    <div className="p-4 space-y-5 pb-10">
      <div className="pt-2"><h1 className="text-2xl font-bold text-slate-800">Settings</h1></div>

      {/* ── Cloud Sync ──────────────────────────────────────────────────────── */}
      {isConfigured() ? (
        <Section title="Cloud Sync">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-sm text-slate-700">{userEmail}</span>
            <button onClick={signOut} className="ml-auto flex items-center gap-1 text-xs text-rose-500">
              <LogOut size={13} /> Sign out
            </button>
          </div>
          {lastSync && <p className="text-xs text-slate-400 mb-3">Last synced {lastSync}</p>}
          <div className="flex gap-2">
            <button onClick={handleSync} disabled={syncing}
              className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50">
              <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} /> Push to Cloud
            </button>
            <button onClick={handlePull} disabled={syncing}
              className="flex-1 flex items-center justify-center gap-2 bg-slate-100 text-slate-700 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50">
              <Download size={15} /> Pull from Cloud
            </button>
          </div>
        </Section>
      ) : (
        <Section title="Cloud Sync — Not Configured">
          <p className="text-sm text-slate-600 mb-3">Set up Supabase to sync across devices and enable SMS auto-tracking.</p>
          <a href="https://supabase.com" target="_blank" rel="noreferrer"
            className="flex items-center justify-center gap-2 bg-indigo-600 text-white rounded-xl py-3 font-semibold text-sm">
            <ExternalLink size={16} /> Create free Supabase project
          </a>
          <div className="mt-3 space-y-2 text-xs text-slate-500">
            <p>1. Create project → SQL Editor → run <code className="bg-slate-100 px-1 rounded">supabase/schema.sql</code></p>
            <p>2. Settings → API → copy Project URL &amp; anon key</p>
            <p>3. Create <code className="bg-slate-100 px-1 rounded">.env</code> from <code className="bg-slate-100 px-1 rounded">.env.example</code> and fill them in</p>
            <p>4. Rebuild &amp; redeploy to Netlify</p>
          </div>
        </Section>
      )}

      {/* ── Push Notifications ──────────────────────────────────────────────── */}
      <Section title="Push Notifications">
        {pushStatus === 'granted' ? (
          <div className="flex items-center gap-3">
            <Bell size={18} className="text-emerald-500" />
            <p className="text-sm text-emerald-700 font-medium">Notifications enabled — you'll get instant alerts for SMS transactions.</p>
          </div>
        ) : pushStatus === 'denied' ? (
          <div className="flex items-center gap-3">
            <BellOff size={18} className="text-rose-400" />
            <p className="text-sm text-slate-600">Notifications blocked. Enable in browser settings → site permissions.</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-600 mb-3">
              Allow notifications so every bank SMS instantly shows a pop-up on your screen — tap Confirm in one tap without opening the app.
            </p>
            <button onClick={handleEnablePush} disabled={pushBusy || !isConfigured()}
              className="btn-primary w-full flex items-center justify-center gap-2">
              {pushBusy
                ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <Bell size={16} />}
              Enable Push Notifications
            </button>
            {!isConfigured() && <p className="text-xs text-slate-400 mt-2 text-center">Set up cloud sync first</p>}
          </>
        )}
      </Section>

      {/* ── SMS Auto-Tracking ────────────────────────────────────────────────── */}
      <Section title="SMS Auto-Tracking">
        <p className="text-sm text-slate-500 mb-4">
          Install <strong>SMS Forwarder</strong> on your Android phone and point it at this webhook. Every bank debit/credit will appear as a push notification for one-tap confirmation.
        </p>

        <div className="space-y-3">
          {/* Step 1 */}
          <SetupStep n={1} title="Install SMS Forwarder">
            <a href="https://play.google.com/store/apps/details?id=com.fractions.smsforwarder"
              target="_blank" rel="noreferrer"
              className="flex items-center gap-2 text-indigo-600 text-sm font-medium">
              <Smartphone size={14} /> Open in Play Store
            </a>
          </SetupStep>

          {/* Step 2 */}
          <SetupStep n={2} title="Add a Webhook filter">
            <p className="text-xs text-slate-500 mb-2">In the app: Filters → + → HTTP/URL → paste these:</p>
            <div className="bg-slate-50 rounded-xl p-3 space-y-2">
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Webhook URL</p>
                <p className="text-xs font-mono text-slate-700 break-all">{webhookUrl}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Request Body (JSON)</p>
                <p className="text-xs font-mono text-slate-700 break-all whitespace-pre">{`{"token":"${webhookToken || 'YOUR_TOKEN'}","sms":"%sms_body%","sender":"%sms_sender%","timestamp":"%sms_received_timestamp%"}`}</p>
              </div>
              <button onClick={copyWebhookUrl}
                className="flex items-center gap-1.5 text-xs text-indigo-600 font-medium mt-1">
                {copied ? <><Check size={12} /> Copied!</> : <><Copy size={12} /> Copy URL + Token</>}
              </button>
            </div>
          </SetupStep>

          {/* Step 3 */}
          <SetupStep n={3} title="Set sender filter">
            <p className="text-xs text-slate-500">
              In SMS Forwarder, set <strong>From</strong> filter to only forward bank SMS. Common sender IDs:
            </p>
            <p className="text-xs font-mono bg-slate-50 p-2 rounded-lg mt-1 text-slate-600">
              HDFCBK, SBIINB, ICICIB, AXISBK, KOTAKB, IDFCFB, YESBNK, INDBNK
            </p>
            <p className="text-xs text-slate-400 mt-1">Or leave blank to forward all SMS (app will ignore non-bank ones).</p>
          </SetupStep>

          {/* Step 4 */}
          <SetupStep n={4} title="Enable push notifications above ↑" />
        </div>

        {/* VAPID setup note */}
        {!import.meta.env.VITE_VAPID_PUBLIC_KEY && (
          <div className="mt-3 p-3 bg-amber-50 rounded-xl text-xs text-amber-700">
            <strong>Push key missing.</strong> Run <code className="bg-amber-100 px-1 rounded">npx web-push generate-vapid-keys</code>,
            add <code className="bg-amber-100 px-1 rounded">VITE_VAPID_PUBLIC_KEY</code> to your .env, and set
            <code className="bg-amber-100 px-1 rounded"> VAPID_PUBLIC_KEY</code>, <code className="bg-amber-100 px-1 rounded">VAPID_PRIVATE_KEY</code>,
            <code className="bg-amber-100 px-1 rounded"> VAPID_SUBJECT</code> in Supabase → Settings → Edge Functions → Secrets.
          </div>
        )}
      </Section>

      {/* ── People ──────────────────────────────────────────────────────────── */}
      <Section title="People">
        <div className="space-y-3">
          <div>
            <label className="label">Person 1 (currently: {settings.person1Name})</label>
            <input className="input" value={p1Name} onChange={e => setP1Name(e.target.value)} placeholder={settings.person1Name} />
          </div>
          <div>
            <label className="label">Person 2 (currently: {settings.person2Name})</label>
            <input className="input" value={p2Name} onChange={e => setP2Name(e.target.value)} placeholder={settings.person2Name} />
          </div>
          <button onClick={saveNames} className="btn-primary w-full">Save Names</button>
        </div>
      </Section>

      {/* ── Financial Year ──────────────────────────────────────────────────── */}
      <Section title="Financial Year">
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={settings.useIndianFY}
            onChange={e => updateSettings({ useIndianFY: e.target.checked })}
            className="w-5 h-5 rounded accent-indigo-600" />
          <span className="text-sm text-slate-700">Use Indian Financial Year (Apr – Mar)</span>
        </label>
      </Section>

      {/* ── Asset Classes ───────────────────────────────────────────────────── */}
      <Section title="Asset Classes">
        <div className="flex flex-wrap gap-2 mb-3">
          {settings.assetClasses.map(ac => (
            <span key={ac} className="flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs font-medium px-3 py-1.5 rounded-full">
              {ac}
              <button onClick={() => removeAssetClass(ac)} className="text-indigo-400 hover:text-rose-500"><Trash2 size={12} /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input className="input flex-1" value={newAsset} onChange={e => setNewAsset(e.target.value)}
            placeholder="New asset class" onKeyDown={e => e.key === 'Enter' && addAssetClass()} />
          <button onClick={addAssetClass} className="bg-indigo-600 text-white rounded-xl px-4"><Plus size={16} /></button>
        </div>
      </Section>

      {/* ── Expense Categories ──────────────────────────────────────────────── */}
      <Section title="Expense Categories">
        <div className="flex flex-wrap gap-2 mb-3">
          {settings.expenseCategories.map(cat => (
            <span key={cat} className="flex items-center gap-1 bg-slate-100 text-slate-700 text-xs font-medium px-3 py-1.5 rounded-full">
              {cat}
              <button onClick={() => removeCategory(cat)} className="text-slate-400 hover:text-rose-500"><Trash2 size={12} /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input className="input flex-1" value={newCat} onChange={e => setNewCat(e.target.value)}
            placeholder="New category" onKeyDown={e => e.key === 'Enter' && addCategory()} />
          <button onClick={addCategory} className="bg-indigo-600 text-white rounded-xl px-4"><Plus size={16} /></button>
        </div>
      </Section>

      {/* ── Import Rules ────────────────────────────────────────────────────── */}
      <Section title="Auto-Categorisation Rules">
        <p className="text-xs text-slate-400 mb-3">Description contains → Category (used for CSV + SMS imports).</p>
        <div className="space-y-2 mb-3">
          {(rules ?? []).map(r => (
            <div key={r.id} className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-xl">
              <span className="text-sm text-slate-700">
                <code className="bg-slate-200 px-1 rounded text-xs">{r.pattern}</code> → {r.category}
              </span>
              <button onClick={() => deleteRule(r)} className="text-slate-300 hover:text-rose-500"><Trash2 size={14} /></button>
            </div>
          ))}
          {(rules ?? []).length === 0 && <p className="text-xs text-slate-400 text-center py-2">No rules yet — they're saved automatically when you categorise CSV imports.</p>}
        </div>
        <div className="grid grid-cols-5 gap-2">
          <input className="input col-span-2" value={newRulePattern} onChange={e => setNewRulePattern(e.target.value)} placeholder="pattern" />
          <select className="input col-span-2" value={newRuleCat} onChange={e => setNewRuleCat(e.target.value)}>
            <option value="">Category</option>
            {settings.expenseCategories.map(c => <option key={c}>{c}</option>)}
          </select>
          <button onClick={addRule} className="bg-indigo-600 text-white rounded-xl flex items-center justify-center"><Plus size={16} /></button>
        </div>
      </Section>

      {/* ── Backup ──────────────────────────────────────────────────────────── */}
      <Section title="Backup / Restore">
        <p className="text-xs text-slate-400 mb-4">
          {isConfigured()
            ? 'Your data auto-syncs to the cloud. Use JSON export as an extra backup or to move data to another account.'
            : 'All data lives on this device. Export regularly as a backup.'}
        </p>
        <div className="flex flex-col gap-3">
          <button onClick={exportData}
            className="flex items-center justify-center gap-2 bg-indigo-600 text-white rounded-xl py-3 font-semibold text-sm">
            <Download size={18} /> Export All Data (JSON)
          </button>
          <label className="flex items-center justify-center gap-2 bg-white border-2 border-dashed border-slate-200 text-slate-600 rounded-xl py-3 font-semibold text-sm cursor-pointer hover:border-indigo-300">
            <Upload size={18} /> Import from JSON Backup
            <input type="file" accept=".json" className="hidden" onChange={importData} />
          </label>
          {importStatus && (
            <p className={`text-center text-sm font-medium ${importStatus.startsWith('✓') ? 'text-emerald-600' : 'text-rose-600'}`}>
              {importStatus}
            </p>
          )}
        </div>
      </Section>
    </div>
  );
}

// ── Small layout helpers ──────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
      <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">{title}</h2>
      {children}
    </div>
  );
}

function SetupStep({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{n}</span>
      <div className="flex-1">
        <p className="text-sm font-medium text-slate-700 mb-1">{title}</p>
        {children}
      </div>
    </div>
  );
}
