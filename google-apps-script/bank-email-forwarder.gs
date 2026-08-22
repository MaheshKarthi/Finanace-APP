/**
 * Bank Email Forwarder — Google Apps Script
 *
 * Setup (do this in BOTH Gmail accounts):
 * 1. Go to script.google.com → New project
 * 2. Paste this entire script
 * 3. Fill in WEBHOOK_URL and WEBHOOK_TOKEN below
 * 4. Click Save → Run → forwardBankEmails (approve permissions)
 * 5. Click Triggers (clock icon) → Add Trigger:
 *    - Function: forwardBankEmails
 *    - Event source: Time-driven
 *    - Type: Minutes timer → Every 5 minutes
 * 6. Save trigger
 *
 * The script runs every 5 minutes, finds new bank emails,
 * forwards them to your finance app webhook, and labels them as processed.
 */

// ── CONFIG — fill these in ────────────────────────────────────────────────────
const WEBHOOK_URL   = 'https://yfvlyncxtbcncpxydpyi.supabase.co/functions/v1/email-webhook';
const WEBHOOK_TOKEN = '76a49fca177eeaf1e38d97bd7329ac5e5847a46db4229e11';
const PROCESSED_LABEL = 'finance-app-processed'; // auto-created if missing
// ─────────────────────────────────────────────────────────────────────────────

// Bank sender keywords — emails from these senders will be processed
const BANK_SENDERS = [
  'hdfc',
  'hdfcbank',
  'sbi',
  'onlinesbi',
  'icici',
  'icicibankltd',
  'amex',
  'americanexpress',
  'scapia',
  'federalbank',
  'canarabank',
  'axisbank',
  'axis',
];

// Subject keywords — only process emails that look like transaction alerts
const TRANSACTION_KEYWORDS = [
  'debited', 'credited', 'spent', 'transaction', 'alert',
  'payment', 'transfer', 'withdrawn', 'deposited', 'charged',
  'txn', 'upi', 'neft', 'imps', 'emi',
];

function forwardBankEmails() {
  // Get or create the processed label
  let label = GmailApp.getUserLabelByName(PROCESSED_LABEL);
  if (!label) label = GmailApp.createLabel(PROCESSED_LABEL);

  // Search for recent unprocessed bank emails (last 24 hours)
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const query  = `after:${Math.floor(cutoff.getTime() / 1000)} -label:${PROCESSED_LABEL}`;

  const threads = GmailApp.search(query, 0, 50);

  for (const thread of threads) {
    const messages = thread.getMessages();
    for (const msg of messages) {
      if (msg.getDate() < cutoff) continue;

      const from    = msg.getFrom().toLowerCase();
      const subject = msg.getSubject().toLowerCase();

      // Check if from a bank
      const isBank = BANK_SENDERS.some(s => from.includes(s));
      if (!isBank) continue;

      // Check if it looks like a transaction
      const isTransaction = TRANSACTION_KEYWORDS.some(k => subject.includes(k));
      if (!isTransaction) continue;

      // Get email body (plain text preferred)
      let body = msg.getPlainBody() || msg.getBody();
      // Strip HTML tags if body is HTML
      body = body.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
      // Limit size
      body = body.slice(0, 2000);

      try {
        const payload = {
          token:   WEBHOOK_TOKEN,
          subject: msg.getSubject(),
          body:    body,
          from:    msg.getFrom(),
          date:    msg.getDate().toISOString(),
        };

        const response = UrlFetchApp.fetch(WEBHOOK_URL, {
          method:      'post',
          contentType: 'application/json',
          payload:     JSON.stringify(payload),
          muteHttpExceptions: true,
        });

        const result = JSON.parse(response.getContentText());
        if (result.status === 'ok' || result.status === 'skipped') {
          // Mark as processed so we don't send it again
          thread.addLabel(label);
        }

        console.log(`[${msg.getDate().toISOString()}] ${msg.getSubject()} → ${result.status ?? 'error'}`);
      } catch (e) {
        console.error('Failed to forward email:', e);
      }
    }
  }
}
