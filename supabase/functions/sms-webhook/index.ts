/**
 * Supabase Edge Function — sms-webhook
 *
 * Receives an SMS forwarded from the Android "SMS Forwarder" app,
 * parses it for Indian bank transactions, checks merchant memory,
 * saves to pending_sms, and fires a Web Push notification.
 *
 * Deploy:
 *   supabase functions deploy sms-webhook --no-verify-jwt
 *
 * Required Edge Function secrets (set via Supabase dashboard → Settings → Edge Functions):
 *   VAPID_PUBLIC_KEY   — from npx web-push generate-vapid-keys
 *   VAPID_PRIVATE_KEY  — from npx web-push generate-vapid-keys
 *   VAPID_SUBJECT      — mailto:your@email.com
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

// ── Types ────────────────────────────────────────────────────────────────────
interface SMSPayload {
  token: string;       // user's webhook token (from Settings page)
  sms: string;         // raw SMS body
  sender?: string;     // sender ID e.g. "HDFCBK"
  timestamp?: string;  // ISO timestamp of SMS
}

interface ParsedSMS {
  type: 'expense' | 'credit' | 'unknown';
  amount: number;
  description: string;
  category: string;
  date: string;
  bank: string;
  merchantCount: number;   // filled after merchant-memory lookup
}

// ── Indian Bank Debit Patterns ───────────────────────────────────────────────
const DEBIT_PATTERNS: { bank: string; re: RegExp }[] = [
  { bank: 'HDFC',    re: /Rs\.?([\d,]+(?:\.\d+)?)\s+debited from/i },
  { bank: 'SBI',     re: /debited by Rs\.?\s*([\d,]+(?:\.\d+)?)/i },
  { bank: 'ICICI',   re: /Rs\.?\s*([\d,]+(?:\.\d+)?)\s+debited from ICICI/i },
  { bank: 'Axis',    re: /Rs\.?([\d,]+(?:\.\d+)?)\s+has been debited/i },
  { bank: 'Kotak',   re: /Rs\.?([\d,]+(?:\.\d+)?)\s+debited from your Kotak/i },
  { bank: 'IDFC',    re: /INR\s*([\d,]+(?:\.\d+)?)\s+has been debited/i },
  { bank: 'IndusInd',re: /INR\s*([\d,]+(?:\.\d+)?)\s+debited from IndusInd/i },
  { bank: 'Yes',     re: /Rs\.?([\d,]+(?:\.\d+)?)\s+has been debited from Yes Bank/i },
  { bank: 'UPI',     re: /(?:UPI|IMPS).*?(?:debit|debited).*?(?:INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)/i },
  { bank: 'Card',    re: /(?:spent|used).*?(?:INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)/i },
  { bank: 'Bank',    re: /(?:INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)\s+(?:debited|withdrawn|paid)/i },
];

const CREDIT_PATTERNS: { bank: string; re: RegExp }[] = [
  { bank: 'HDFC',  re: /Rs\.?([\d,]+(?:\.\d+)?)\s+credited to/i },
  { bank: 'SBI',   re: /credited by Rs\.?\s*([\d,]+(?:\.\d+)?)/i },
  { bank: 'ICICI', re: /Rs\.?\s*([\d,]+(?:\.\d+)?)\s+credited to ICICI/i },
  { bank: 'Bank',  re: /(?:INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)\s+credited/i },
];

// ── Category auto-detection ──────────────────────────────────────────────────
const CATEGORY_RULES: [RegExp, string][] = [
  [/swiggy|zomato|dominos|pizza|kfc|mcdonald|burger|cafe|restaurant|dhaba|biryani/i, 'Food'],
  [/grofer|blinkit|zepto|dmart|bigbasket|grocery|kirana|supermarket|reliance fresh/i, 'Groceries'],
  [/petrol|diesel|hp\b|iocl|bpcl|shell|indian oil|bharat petroleum|fuel/i, 'Fuel'],
  [/amazon|flipkart|myntra|meesho|ajio|nykaa|tata cliq|shopping/i, 'Shopping'],
  [/ola\b|uber|rapido|auto\b|taxi|metro|irctc|flight|makemytrip|goibibo|booking\.com/i, 'Travel'],
  [/apollo|medplus|pharma|hospital|clinic|doctor|lab|health|1mg|netmeds/i, 'Healthcare'],
  [/netflix|hotstar|prime\b|spotify|youtube premium|zee5|jio cinema/i, 'Entertainment'],
  [/emi\b|loan|housing loan|car loan|bike loan|bajaj|hdfc home/i, 'EMI'],
  [/electricity|bescom|msedcl|water\s+bill|gas\s+bill|postpaid|broadband|wifi|jio\b|airtel\b|bsnl\b|vi\b/i, 'Utilities'],
  [/school|college|fee|tuition|byju|unacademy|course|edtech/i, 'Education'],
  [/rent\b|pg\b|paying guest/i, 'Rent'],
  [/lic\b|insurance|premium|policy/i, 'Insurance'],
];

function categorize(text: string): string {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(text)) return cat;
  return 'Other';
}

function extractMerchant(sms: string): string {
  const patterns = [
    /to\s+([A-Z][A-Z0-9 &.\-/]{2,35})/i,
    /at\s+([A-Z][A-Z0-9 &.\-/]{2,35})/i,
    /for\s+([A-Z][A-Z0-9 &.\-/]{2,35})/i,
    /UPI[:/]\s*([A-Z0-9@.\-_]{4,40})/i,
    /Info:\s*([^\n.]{3,40})/i,
    /to VPA\s+([^\s]{4,40})/i,
  ];
  for (const p of patterns) {
    const m = sms.match(p);
    if (m) return m[1].trim().replace(/\s{2,}/g, ' ').slice(0, 40);
  }
  return '';
}

function extractDate(sms: string, fallback: string): string {
  // DD-Mon-YY  or  DD/MM/YY  or  DD-MM-YYYY
  const monthNames: Record<string, string> = {
    jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
    jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
  };
  const m1 = sms.match(/(\d{2})-([A-Za-z]{3})-(\d{2,4})/);
  if (m1) {
    const yr = m1[3].length === 2 ? '20'+m1[3] : m1[3];
    return `${yr}-${monthNames[m1[2].toLowerCase()] ?? '01'}-${m1[1]}`;
  }
  const m2 = sms.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{2,4})/);
  if (m2) {
    const yr = m2[3].length === 2 ? '20'+m2[3] : m2[3];
    return `${yr}-${m2[2].padStart(2,'0')}-${m2[1].padStart(2,'0')}`;
  }
  return fallback;
}

function parseSMS(sms: string, timestamp?: string): Omit<ParsedSMS, 'merchantCount'> {
  const today = (timestamp ? new Date(timestamp) : new Date()).toISOString().slice(0, 10);

  for (const { bank, re } of DEBIT_PATTERNS) {
    const m = sms.match(re);
    if (!m) continue;
    const amount = parseFloat(m[1].replace(/,/g, ''));
    const description = extractMerchant(sms);
    return { type: 'expense', amount, description, category: categorize(sms + ' ' + description), date: extractDate(sms, today), bank };
  }
  for (const { bank, re } of CREDIT_PATTERNS) {
    const m = sms.match(re);
    if (!m) continue;
    const amount = parseFloat(m[1].replace(/,/g, ''));
    return { type: 'credit', amount, description: 'Credit received', category: 'Income', date: extractDate(sms, today), bank };
  }
  return { type: 'unknown', amount: 0, description: sms.slice(0, 60), category: 'Other', date: today, bank: 'Unknown' };
}

// ── Merchant memory: look up past expense records ────────────────────────────
async function getMerchantCount(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  description: string,
  parsedCategory: string,
): Promise<{ count: number; bestCategory: string }> {
  if (!description) return { count: 0, bestCategory: parsedCategory };

  const { data } = await supabase
    .from('sync_data')
    .select('records')
    .eq('user_id', userId)
    .eq('table_name', 'expenses')
    .single();

  if (!data?.records) return { count: 0, bestCategory: parsedCategory };

  const expenses: { description: string; category: string }[] =
    typeof data.records === 'string' ? JSON.parse(data.records) : data.records;

  // Match on first 6+ chars of merchant name (case-insensitive)
  const keyword = description.toLowerCase().slice(0, 8);
  const matches = expenses.filter(e => e.description?.toLowerCase().includes(keyword));

  if (!matches.length) return { count: 0, bestCategory: parsedCategory };

  // Most-used category wins
  const freq: Record<string, number> = {};
  for (const e of matches) freq[e.category] = (freq[e.category] ?? 0) + 1;
  const bestCategory = Object.entries(freq).sort(([,a],[,b]) => b - a)[0][0];

  return { count: matches.length, bestCategory };
}

// ── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' },
    });
  }

  try {
    const body: SMSPayload = await req.json();
    const { token, sms, sender, timestamp } = body;
    if (!token || !sms) return new Response(JSON.stringify({ error: 'Missing token or sms' }), { status: 400 });

    const sbUrl  = Deno.env.get('SUPABASE_URL')!;
    const sbKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(sbUrl, sbKey);

    // Validate webhook token → get user
    const { data: tokenRow } = await supabase
      .from('webhook_tokens')
      .select('user_id')
      .eq('token', token)
      .single();
    if (!tokenRow) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });
    const userId = tokenRow.user_id as string;

    // Parse SMS
    const raw = parseSMS(sms, timestamp);

    // Skip OTPs, balance alerts, promo SMS
    if (raw.type === 'unknown' || raw.amount <= 0) {
      return new Response(JSON.stringify({ status: 'skipped', reason: 'not a financial transaction' }));
    }

    // Merchant memory
    const { count: merchantCount, bestCategory } =
      await getMerchantCount(supabase, userId, raw.description, raw.category);

    // Use learned category if seen 3+ times
    const finalCategory = merchantCount >= 3 ? bestCategory : raw.category;
    const parsed: ParsedSMS = { ...raw, category: finalCategory, merchantCount };

    // Save to pending_sms
    const { data: smsRow, error: insErr } = await supabase
      .from('pending_sms')
      .insert({ user_id: userId, raw_sms: sms, sender: sender ?? null, sms_time: timestamp ?? new Date().toISOString(), parsed })
      .select('id')
      .single();
    if (insErr || !smsRow) throw insErr ?? new Error('Insert failed');

    // ── Send Web Push notification ─────────────────────────────────────────
    const vapidPublic  = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';

    if (vapidPublic && vapidPrivate) {
      const { data: pushRow } = await supabase
        .from('push_subscriptions')
        .select('subscription')
        .eq('user_id', userId)
        .single();

      if (pushRow?.subscription) {
        try {
          webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
          const sub = typeof pushRow.subscription === 'string'
            ? JSON.parse(pushRow.subscription)
            : pushRow.subscription;

          const confidenceNote = merchantCount >= 10
            ? ` · known merchant (${merchantCount}×)`
            : merchantCount >= 3
            ? ` · seen ${merchantCount}× before`
            : '';

          await webpush.sendNotification(sub, JSON.stringify({
            title: `💳 ${parsed.type === 'credit' ? 'Credit' : 'Debit'} ${new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(parsed.amount)}`,
            body:  `${parsed.description || parsed.bank} · ${finalCategory}${confidenceNote}`,
            pendingId:     smsRow.id,
            amount:        parsed.amount,
            description:   parsed.description,
            category:      finalCategory,
            date:          parsed.date,
            merchantCount,
          }));
        } catch (pushErr) {
          console.warn('[push] notification failed:', pushErr);
          // Don't fail the whole request — SMS is still saved
        }
      }
    }

    return new Response(JSON.stringify({ status: 'ok', pendingId: smsRow.id, parsed }));
  } catch (err) {
    console.error('[sms-webhook]', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
