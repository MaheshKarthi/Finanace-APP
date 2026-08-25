/**
 * Supabase Edge Function — email-webhook
 * Accepts bank email data from Google Apps Script,
 * parses transactions, saves to pending_sms, sends push notification.
 *
 * Deploy:
 *   supabase functions deploy email-webhook --no-verify-jwt
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

interface EmailPayload {
  token: string;
  subject: string;
  body: string;
  from: string;
  date: string; // ISO string
  person?: string; // 'person1' or 'person2'
}

interface Parsed {
  type: 'expense' | 'credit' | 'unknown';
  amount: number;
  description: string;
  category: string;
  date: string;
  bank: string;
}

// ── Debit patterns for email bodies ──────────────────────────────────────────
const DEBIT_PATTERNS: { bank: string; re: RegExp }[] = [
  // HDFC
  { bank: 'HDFC',    re: /(?:INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)\s+(?:has been )?debited/i },
  { bank: 'HDFC',    re: /debited.*?(?:INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)/i },
  { bank: 'HDFC',    re: /(?:INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)\s+spent/i },
  // SBI
  { bank: 'SBI',     re: /debited by Rs\.?\s*([\d,]+(?:\.\d+)?)/i },
  { bank: 'SBI',     re: /Rs\.?\s*([\d,]+(?:\.\d+)?)\s+debited from SBI/i },
  // ICICI
  { bank: 'ICICI',   re: /INR\s*([\d,]+(?:\.\d+)?)\s+spent using ICICI/i },
  { bank: 'ICICI',   re: /Rs\.?\s*([\d,]+(?:\.\d+)?)\s+debited.*?ICICI/i },
  // AMEX
  { bank: 'AMEX',    re: /(?:INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)\s+(?:has been )?charged/i },
  { bank: 'AMEX',    re: /You(?:'ve| have) spent\s+(?:INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)/i },
  { bank: 'AMEX',    re: /transaction of\s+(?:INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)/i },
  // Federal / Scapia
  { bank: 'Federal', re: /(?:INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)\s+(?:has been )?debited.*?Federal/i },
  { bank: 'Scapia',  re: /(?:INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)\s+(?:spent|used).*?Scapia/i },
  // Canara
  { bank: 'Canara',  re: /(?:INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)\s+debited.*?Canara/i },
  // Axis
  { bank: 'Axis',    re: /Rs\.?([\d,]+(?:\.\d+)?)\s+has been debited/i },
  { bank: 'Axis',    re: /(?:INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)\s+(?:spent|debited).*?Axis/i },
  // Generic
  { bank: 'Bank',    re: /(?:INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)\s+(?:debited|spent|paid|withdrawn)/i },
  { bank: 'Bank',    re: /(?:debit|payment) of\s+(?:INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)/i },
  // UPI / generic amount patterns
  { bank: 'Bank',    re: /(?:paid|sent|transferred)\s+(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d+)?)/i },
  { bank: 'Bank',    re: /(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d+)?)\s+(?:paid|sent|transferred|debited|spent|deducted)/i },
  { bank: 'Bank',    re: /amount[:\s]+(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d+)?)/i },
  { bank: 'Bank',    re: /₹\s*([\d,]+(?:\.\d+)?)\s+(?:debited|paid|spent|sent|deducted|transferred)/i },
  { bank: 'Bank',    re: /you (?:paid|sent|transferred)\s+(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d+)?)/i },
  { bank: 'Bank',    re: /(?:txn|transaction) (?:of|for|amount)[:\s]+(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d+)?)/i },
  // Last resort: any standalone ₹ amount in the email
  { bank: 'Bank',    re: /₹\s*([\d,]+(?:\.\d+)?)/ },
  { bank: 'Bank',    re: /(?:INR|Rs\.)\s*([\d,]+(?:\.\d+)?)/ },
];

const CREDIT_PATTERNS: { bank: string; re: RegExp }[] = [
  { bank: 'HDFC',    re: /(?:INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)\s+(?:has been )?credited/i },
  { bank: 'HDFC',    re: /(?:INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)\s+deposited/i },
  { bank: 'ICICI',   re: /credited with\s+(?:INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)/i },
  { bank: 'SBI',     re: /credited by Rs\.?\s*([\d,]+(?:\.\d+)?)/i },
  { bank: 'Bank',    re: /(?:INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)\s+(?:credited|deposited|received)/i },
  { bank: 'Bank',    re: /credit of\s+(?:INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)/i },
];

// ── Category detection ────────────────────────────────────────────────────────
const CATEGORY_RULES: [RegExp, string][] = [
  [/swiggy|zomato|dominos|pizza|kfc|mcdonald|burger|cafe|restaurant|dhaba|biryani|food/i, 'Food'],
  [/grofer|blinkit|zepto|dmart|bigbasket|grocery|kirana|supermarket|reliance fresh/i, 'Groceries'],
  [/petrol|diesel|hp\b|iocl|bpcl|shell|indian oil|bharat petroleum|fuel/i, 'Fuel'],
  [/amazon|flipkart|myntra|meesho|ajio|nykaa|tata cliq|shopping/i, 'Shopping'],
  [/ola\b|uber|rapido|auto\b|taxi|metro|irctc|flight|makemytrip|goibibo|booking/i, 'Travel'],
  [/apollo|medplus|pharma|hospital|clinic|doctor|lab|health|1mg|netmeds/i, 'Healthcare'],
  [/netflix|hotstar|prime\b|spotify|youtube|zee5|jio cinema|entertainment/i, 'Entertainment'],
  [/emi\b|loan|housing|car loan|bike loan|bajaj finance/i, 'EMI'],
  [/electricity|bescom|msedcl|water bill|gas bill|postpaid|broadband|wifi|jio\b|airtel\b|bsnl\b/i, 'Utilities'],
  [/school|college|fee|tuition|byju|unacademy|course|edtech/i, 'Education'],
  [/rent\b|pg\b|paying guest/i, 'Rent'],
  [/lic\b|insurance|premium|policy/i, 'Insurance'],
];

function categorize(text: string): string {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(text)) return cat;
  return 'Other';
}

// ── Detect bank from sender/subject ──────────────────────────────────────────
function detectBank(from: string, subject: string): string {
  const t = `${from} ${subject}`.toLowerCase();
  if (t.includes('hdfc'))    return 'HDFC';
  if (t.includes('sbi'))     return 'SBI';
  if (t.includes('icici'))   return 'ICICI';
  if (t.includes('amex') || t.includes('american express')) return 'AMEX';
  if (t.includes('scapia') || t.includes('federal')) return 'Federal/Scapia';
  if (t.includes('canara'))  return 'Canara';
  if (t.includes('axis'))    return 'Axis';
  return 'Bank';
}

// ── Extract merchant from email body ─────────────────────────────────────────
function extractMerchant(body: string): string {
  // 1. UPI VPA like "swiggy@icici" → extract name before @
  const vpaMatch = body.match(/(?:to|vpa|upi id|paid to|sent to)[:\s]+([A-Za-z0-9.\-_]+)@[A-Za-z0-9.\-_]+/i);
  if (vpaMatch) {
    const name = vpaMatch[1].replace(/[.\-_]/g, ' ').trim();
    if (name.length >= 3) return toTitleCase(name);
  }

  // 2. Explicit labeled fields
  const labeled = [
    /(?:paid to|transferred to|sent to|merchant)[:\s]+([A-Za-z0-9 &.\-/]{4,40})/i,
    /^to[:\s]+([A-Za-z0-9 &.\-/]{4,40})/im,
    /(?:beneficiary|payee)[:\s]+([A-Za-z0-9 &.\-/]{4,40})/i,
    /(?:description|narration|info|remarks)[:\s]+([A-Za-z][A-Za-z0-9 &.\-/]{3,40})/i,
  ];
  for (const p of labeled) {
    const m = body.match(p);
    if (m) {
      const val = m[1].trim();
      if (val.length >= 4 && !/^\d+$/.test(val)) return toTitleCase(val.slice(0, 40));
    }
  }

  // 3. "at MERCHANT" — only if MERCHANT is all-caps or title-case (real brand name)
  const atMatch = body.match(/\bat\s+([A-Z][A-Z0-9 &]{3,30})/);
  if (atMatch) return toTitleCase(atMatch[1].trim());

  return '';
}

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim();
}

// ── Parse email body ──────────────────────────────────────────────────────────
function parseEmail(subject: string, body: string, from: string, emailDate: string): Parsed {
  const text = `${subject}\n${body}`;
  const fallbackDate = emailDate ? new Date(emailDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const bank = detectBank(from, subject);

  for (const { re } of DEBIT_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    const amount = parseFloat(m[1].replace(/,/g, ''));
    if (!amount || amount <= 0) continue;
    const description = extractMerchant(text);
    return { type: 'expense', amount, description, category: categorize(text), date: fallbackDate, bank };
  }

  for (const { re } of CREDIT_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    const amount = parseFloat(m[1].replace(/,/g, ''));
    if (!amount || amount <= 0) continue;
    return { type: 'credit', amount, description: 'Credit received', category: 'Income', date: fallbackDate, bank };
  }

  return { type: 'unknown', amount: 0, description: subject.slice(0, 60), category: 'Other', date: fallbackDate, bank };
}

// ── Merchant memory ───────────────────────────────────────────────────────────
async function getMerchantCount(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  description: string,
  parsedCategory: string,
): Promise<{ count: number; bestCategory: string }> {
  if (!description) return { count: 0, bestCategory: parsedCategory };
  const { data } = await supabase.from('sync_data').select('records').eq('user_id', userId).eq('table_name', 'expenses').single();
  if (!data?.records) return { count: 0, bestCategory: parsedCategory };
  const expenses: { description: string; category: string }[] = typeof data.records === 'string' ? JSON.parse(data.records) : data.records;
  const keyword = description.toLowerCase().slice(0, 8);
  const matches = expenses.filter(e => e.description?.toLowerCase().includes(keyword));
  if (!matches.length) return { count: 0, bestCategory: parsedCategory };
  const freq: Record<string, number> = {};
  for (const e of matches) freq[e.category] = (freq[e.category] ?? 0) + 1;
  const bestCategory = Object.entries(freq).sort(([, a], [, b]) => b - a)[0][0];
  return { count: matches.length, bestCategory };
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }

  try {
    const body: EmailPayload = await req.json();
    const { token, subject, body: emailBody, from, date, person } = body;

    if (!token || !subject) return new Response(JSON.stringify({ error: 'Missing token or subject' }), { status: 400 });

    const sbUrl = Deno.env.get('SUPABASE_URL')!;
    const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(sbUrl, sbKey);

    // Validate token
    const { data: tokenRow } = await supabase.from('webhook_tokens').select('user_id').eq('token', token).single();
    if (!tokenRow) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });
    const userId = tokenRow.user_id as string;

    // Parse email
    const parsed = parseEmail(subject, emailBody ?? '', from ?? '', date ?? new Date().toISOString());
    if (parsed.type === 'unknown' || parsed.amount <= 0) {
      return new Response(JSON.stringify({ status: 'skipped', reason: 'not a transaction email' }));
    }

    // Merchant memory
    const { count: merchantCount, bestCategory } = await getMerchantCount(supabase, userId, parsed.description, parsed.category);
    const finalCategory = merchantCount >= 3 ? bestCategory : parsed.category;

    // Dedup — skip if same email (same subject + date) already exists
    const { count: existing } = await supabase
      .from('pending_sms')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('sms_time', date ?? new Date().toISOString())
      .ilike('raw_sms', `%${subject.slice(0, 40)}%`);
    if (existing && existing > 0) {
      return new Response(JSON.stringify({ status: 'skipped', reason: 'duplicate' }));
    }

    // Save to pending_sms table (reusing same table for emails too)
    const { data: row, error: insErr } = await supabase
      .from('pending_sms')
      .insert({
        user_id: userId,
        raw_sms: `[EMAIL] ${subject}\n${emailBody ?? ''}`.slice(0, 1000),
        sender: from ?? 'email',
        sms_time: date ?? new Date().toISOString(),
        parsed: { ...parsed, category: finalCategory, merchantCount, person: person ?? 'person1' },
      })
      .select('id').single();
    if (insErr || !row) throw insErr ?? new Error('Insert failed');

    // Send push notification
    const vapidPublic  = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';

    if (vapidPublic && vapidPrivate) {
      const { data: pushRow } = await supabase.from('push_subscriptions').select('subscription').eq('user_id', userId).single();
      if (pushRow?.subscription) {
        try {
          webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
          const sub = typeof pushRow.subscription === 'string' ? JSON.parse(pushRow.subscription) : pushRow.subscription;
          const confidenceNote = merchantCount >= 3 ? ` · seen ${merchantCount}× before` : '';
          await webpush.sendNotification(sub, JSON.stringify({
            title: `${parsed.type === 'credit' ? '💰 Credit' : '💳 Debit'} ${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(parsed.amount)}`,
            body: `${parsed.description || parsed.bank} · ${finalCategory}${confidenceNote}`,
            pendingId: row.id,
            amount: parsed.amount,
            description: parsed.description,
            category: finalCategory,
            date: parsed.date,
            merchantCount,
          }));
        } catch (e) { console.warn('[push] failed:', e); }
      }
    }

    return new Response(JSON.stringify({ status: 'ok', pendingId: row.id, parsed: { ...parsed, category: finalCategory } }));
  } catch (err) {
    console.error('[email-webhook]', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
