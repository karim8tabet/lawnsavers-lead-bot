// Cleans a workflow exported from n8n before it is committed to a public repo.
//
// Usage:
//   node scripts/sanitize-export.js <exported.json> [output.json] [--redact-emails]
//
// Removes: pinned test data (can contain customer PII), credential IDs,
// instance/workflow/version IDs. With --redact-emails, replaces every email
// address with you@example.com. Exits with an error if anything that looks
// like a secret is still present, so nothing leaks by accident.

const fs = require('node:fs');

const args = process.argv.slice(2);
const redactEmails = args.includes('--redact-emails');
const [input, output = input] = args.filter((a) => !a.startsWith('--'));
if (!input) {
  console.error('Usage: node scripts/sanitize-export.js <exported.json> [output.json] [--redact-emails]');
  process.exit(1);
}

const wf = JSON.parse(fs.readFileSync(input, 'utf8'));

wf.pinData = {};
delete wf.id;
delete wf.versionId;
delete wf.shared;
delete wf.triggerCount;
if (wf.meta) delete wf.meta.instanceId;
if (wf.settings) delete wf.settings.errorWorkflow; // instance-specific ID

for (const n of wf.nodes || []) {
  for (const cred of Object.values(n.credentials || {})) delete cred.id; // keep the name only
}

let text = JSON.stringify(wf, null, 2) + '\n';
if (redactEmails) text = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'you@example.com');

const SECRET_PATTERNS = [
  [/gsk_[A-Za-z0-9]{20,}/, 'Groq API key'],
  [/pat-[a-z]{2,3}\d?-[0-9a-f-]{20,}/i, 'HubSpot private app token'],
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic API key'],
  [/ya29\.[A-Za-z0-9_-]{20,}/, 'Google OAuth access token'],
  [/Bearer\s+[A-Za-z0-9._-]{20,}/, 'Bearer token'],
];
const leaks = SECRET_PATTERNS.filter(([re]) => re.test(text)).map(([, what]) => what);
if (leaks.length) {
  console.error('Refusing to write: found what looks like a secret: ' + leaks.join(', '));
  process.exit(2);
}

fs.writeFileSync(output, text);
console.log(`Sanitized ${input} -> ${output}`);
