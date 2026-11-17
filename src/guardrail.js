// Guardrail for the LawnSavers Lead Bot.
//
// The LLM's output is never trusted directly. checkLead() takes the
// normalized lead and the raw Groq HTTP response, and returns one object
// with the AI fields plus:
//   needs_human  true if anything looks wrong
//   flags        list of reasons (shown in the manager email)
//   routed_to    "manager" or "auto_reply"
//
// This same code runs inside the n8n Code node (scripts/build-workflows.js
// copies it in), so the unit tests cover exactly what runs in production.

const SERVICES = [
  'lawn care',
  'weed control',
  'aeration',
  'overseeding',
  'tree & shrub care',
  'mosquito/tick control',
  'holiday lighting',
  'other',
];
const URGENCIES = ['high', 'normal'];

// Prices, money and discounts must never go to a customer automatically.
const MONEY_PATTERNS = [
  /\$/,
  /\d+\s*%/,
  /\b\d+\s*(dollars|bucks|cad|usd)\b/i,
  /\b(discount|coupon|promo|rebate|refund|price|pricing|cost|costs|fee|cheap)\b/i,
  /\b(free of charge|for free|free (quote|estimate|service|treatment|visit))\b/i,
  /\b\d+\s*off\b/i,
];

// Promised dates or times: a human should commit to those, not the bot.
const DATE_PATTERNS = [
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(tomorrow|tonight|next week|this week|this weekend)\b/i,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i,
  /\b\d{1,2}(st|nd|rd|th)\b/i,
  /\bwithin\s+\d+\s*(hours?|days?|business days?|weeks?)\b/i,
  /\b(guarantee|guaranteed|promise)\b/i,
];

// Customer text that tries to give the AI new instructions.
const INJECTION_PATTERNS = [
  /\b(ignore|disregard|forget)\b.{0,30}\b(instructions?|rules|prompt|above)\b/i,
  /\bsystem prompt\b/i,
  /\byou are now\b/i,
  /\bact as\b/i,
  /\b(developer|dan|jailbreak) mode\b/i,
  /\bnew instructions?\b/i,
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function matchesAny(text, patterns) {
  return patterns.some((re) => re.test(text));
}

// Spam / junk: too few real letters, mostly symbols, or link-stuffed.
function looksLikeJunk(message) {
  const text = String(message || '');
  const letters = (text.match(/[a-z]/gi) || []).length;
  const nonSpace = text.replace(/\s/g, '').length;
  const links = (text.match(/https?:\/\/|www\./gi) || []).length;
  if (letters < 15) return true;
  if (nonSpace > 0 && letters / nonSpace < 0.6) return true;
  if (links >= 2) return true;
  return false;
}

// Pull the model's text out of the Groq (OpenAI-style) response and parse it.
function parseLlm(groqResponse, flags) {
  if (!groqResponse || groqResponse.error) {
    flags.push('llm_call_failed');
    return null;
  }
  const content =
    groqResponse.choices &&
    groqResponse.choices[0] &&
    groqResponse.choices[0].message &&
    groqResponse.choices[0].message.content;
  if (typeof content !== 'string') {
    flags.push('llm_empty_response');
    return null;
  }
  // Some models wrap JSON in ```json fences even in JSON mode.
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      flags.push('llm_not_an_object');
      return null;
    }
    return parsed;
  } catch (e) {
    flags.push('llm_invalid_json');
    return null;
  }
}

function checkLead(lead, groqResponse, now) {
  const flags = [];
  const ai = parseLlm(groqResponse, flags) || {};

  // 1. Shape check: every field present with the right type and value.
  const out = {
    service_type: ai.service_type,
    urgency: ai.urgency,
    is_complaint: ai.is_complaint,
    summary: ai.summary,
    reply_draft: ai.reply_draft,
  };
  if (flags.length === 0) {
    if (!SERVICES.includes(out.service_type)) flags.push('invalid_service_type');
    if (!URGENCIES.includes(out.urgency)) flags.push('invalid_urgency');
    if (typeof out.is_complaint !== 'boolean') flags.push('invalid_is_complaint');
    if (typeof out.summary !== 'string' || !out.summary.trim()) flags.push('missing_summary');
    if (typeof out.reply_draft !== 'string' || !out.reply_draft.trim()) flags.push('missing_reply_draft');
  }

  // Safe defaults so later nodes (HubSpot, Sheet, email) never get undefined.
  if (!SERVICES.includes(out.service_type)) out.service_type = 'unknown';
  if (!URGENCIES.includes(out.urgency)) out.urgency = 'normal';
  if (typeof out.is_complaint !== 'boolean') out.is_complaint = false;
  if (typeof out.summary !== 'string' || !out.summary.trim()) {
    out.summary = 'AI classification failed. Please review the original message.';
  }
  if (typeof out.reply_draft !== 'string') out.reply_draft = '';

  // 2. Content checks on the AI's reply.
  if (out.service_type === 'other') flags.push('service_not_offered');
  if (matchesAny(out.reply_draft, MONEY_PATTERNS)) flags.push('reply_mentions_money');
  if (matchesAny(out.reply_draft, DATE_PATTERNS)) flags.push('reply_promises_date');

  // 3. Checks on what the customer sent.
  const message = String(lead.message || '');
  if (matchesAny(message, INJECTION_PATTERNS)) flags.push('prompt_injection_suspected');
  if (looksLikeJunk(message)) flags.push('junk_or_spam');
  if (!EMAIL_RE.test(String(lead.email || ''))) flags.push('invalid_email');

  const needs_human = flags.length > 0;
  const routed_to =
    out.is_complaint || out.urgency === 'high' || needs_human ? 'manager' : 'auto_reply';

  return {
    ...lead,
    ...out,
    needs_human,
    flags,
    flags_text: flags.length ? flags.join(', ') : 'none',
    routed_to,
    timestamp: (now || new Date()).toISOString(),
  };
}

module.exports = { checkLead, looksLikeJunk, SERVICES };
