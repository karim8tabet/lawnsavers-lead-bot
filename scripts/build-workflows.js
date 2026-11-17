// Generates the importable n8n workflow files:
//   workflows/lead-bot.json        main workflow
//   workflows/error-handler.json   error workflow
//
// The Groq prompt (prompts/classify-system.md) and the guardrail
// (src/guardrail.js) are copied in from their own files, so there is one
// source of truth and the unit tests cover the code that runs in n8n.
//
// Usage: node scripts/build-workflows.js
// Credentials are NOT included. After import, select one on each red node.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const GROQ_MODEL = 'llama-3.3-70b-versatile'; // check console.groq.com/docs/models for current names
const MANAGER_EMAIL = 'YOUR_EMAIL@gmail.com'; // replace in the n8n UI after import
const WEBHOOK_PATH = 'lawnsavers-lead';

const prompt = fs.readFileSync(path.join(ROOT, 'prompts', 'classify-system.md'), 'utf8').replace(/\r\n/g, '\n').trim();
const guardrailSrc = fs.readFileSync(path.join(ROOT, 'src', 'guardrail.js'), 'utf8').replace(/\r\n/g, '\n');

// ---------- Code node: guardrail source + 3 lines of n8n glue ----------
const jsCode =
  guardrailSrc.replace(/^module\.exports.*$/m, '').trimEnd() +
  `

// ---- n8n glue ----
// $input is the Groq HTTP response; the lead comes from the Normalize node.
const lead = $('Normalize').first().json;
const groqResponse = $input.first().json;
return [{ json: checkLead(lead, groqResponse) }];
`;

// ---------- Groq request body (an n8n expression that builds JSON) ----------
const groqBodyJs = `JSON.stringify({
  model: ${JSON.stringify(GROQ_MODEL)},
  temperature: 0,
  response_format: { type: "json_object" },
  messages: [
    { role: "system", content: ${JSON.stringify(prompt)} },
    { role: "user", content: JSON.stringify({ name: $json.name, city: $json.city, service_requested: $json.service, message: $json.message }) }
  ]
})`;
if (groqBodyJs.includes('{{') || groqBodyJs.includes('}}')) {
  throw new Error('Groq body must not contain "{{" or "}}" (breaks n8n expressions). Check the prompt.');
}

// ---------- helpers ----------
let idCounter = 0;
const uid = (prefix) => `${prefix}-${String(++idCounter).padStart(4, '0')}-4000-8000-${'0'.repeat(12)}`;
const G = (field) => `$('Guardrail').item.json.${field}`;
const str = (name, value) => ({ id: uid('a'), name, value, type: 'string' });
const node = (name, type, typeVersion, x, y, parameters, extra = {}) => ({
  id: uid('n'),
  name,
  type,
  typeVersion,
  position: [x, y],
  parameters,
  ...extra,
});
const link = (to) => [{ node: to, type: 'main', index: 0 }];

const sheetColumns = ['timestamp', 'name', 'email', 'service_type', 'urgency', 'is_complaint', 'needs_human', 'routed_to', 'summary'];

// ---------- main workflow ----------
const nodes = [
  node('Webhook', 'n8n-nodes-base.webhook', 2, 0, 300, {
    httpMethod: 'POST',
    path: WEBHOOK_PATH,
    responseMode: 'onReceived',
    options: {},
  }, { webhookId: 'b7e1c0de-1a2b-4c3d-8e9f-1a2b3c4d5e6f' }),

  node('Normalize', 'n8n-nodes-base.set', 3.4, 220, 300, {
    assignments: {
      assignments: [
        str('name', "={{ String($json.body.name ?? '').trim() }}"),
        str('firstname', "={{ String($json.body.name ?? '').trim().split(/\\s+/)[0] }}"),
        str('lastname', "={{ String($json.body.name ?? '').trim().split(/\\s+/).slice(1).join(' ') }}"),
        str('email', "={{ String($json.body.email ?? '').trim().toLowerCase() }}"),
        str('phone', "={{ String($json.body.phone ?? '').trim() }}"),
        str('city', "={{ String($json.body.city ?? '').trim() }}"),
        str('service', "={{ String($json.body.service ?? '').trim() }}"),
        str('message', "={{ String($json.body.message ?? '').trim().slice(0, 2000) }}"),
        str('source', "={{ $json.body.source ?? 'website' }}"),
      ],
    },
    options: {},
  }),

  node('Groq classify', 'n8n-nodes-base.httpRequest', 4.2, 440, 300, {
    method: 'POST',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: `={{ ${groqBodyJs} }}`,
    options: { timeout: 30000 },
  }, { retryOnFail: true, maxTries: 2, waitBetweenTries: 2000, onError: 'continueRegularOutput' }),

  node('Guardrail', 'n8n-nodes-base.code', 2, 660, 300, { jsCode }),

  node('HubSpot upsert contact', 'n8n-nodes-base.hubspot', 2.1, 880, 300, {
    authentication: 'appToken',
    resource: 'contact',
    operation: 'upsert',
    email: `={{ ${G('email')} }}`,
    additionalFields: {
      firstName: `={{ ${G('firstname')} }}`,
      lastName: `={{ ${G('lastname')} }}`,
      city: `={{ ${G('city')} }}`,
      phoneNumber: `={{ ${G('phone')} }}`,
      lifeCycleStage: 'lead',
    },
  }, { retryOnFail: true, maxTries: 2, waitBetweenTries: 2000 }),

  node('HubSpot add note', 'n8n-nodes-base.httpRequest', 4.2, 1100, 300, {
    method: 'POST',
    url: 'https://api.hubapi.com/crm/v3/objects/notes',
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'hubspotAppToken',
    sendBody: true,
    specifyBody: 'json',
    jsonBody:
      '={{ JSON.stringify({ properties: { hs_timestamp: new Date().toISOString(), hs_note_body: ' +
      "'Lead Bot (' + " + G('routed_to') + " + '): ' + " + G('summary') +
      " + ' | Service: ' + " + G('service_type') +
      " + ' | Urgency: ' + " + G('urgency') +
      " + ' | Flags: ' + " + G('flags_text') +
      " + ' | Message: ' + " + G('message') +
      ' }, associations: [ { to: { id: String($json.vid ?? $json["canonical-vid"] ?? $json.id) }, types: [ { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 } ] } ] }) }}',
    options: {},
  }, { retryOnFail: true, maxTries: 2, waitBetweenTries: 2000 }),

  node('Log to Google Sheet', 'n8n-nodes-base.googleSheets', 4.5, 1320, 300, {
    operation: 'append',
    documentId: { __rl: true, value: '', mode: 'list' },
    sheetName: { __rl: true, value: '', mode: 'list' },
    columns: {
      mappingMode: 'defineBelow',
      value: Object.fromEntries(sheetColumns.map((c) => [c, `={{ ${G(c)} }}`])),
      matchingColumns: [],
      schema: sheetColumns.map((c) => ({
        id: c, displayName: c, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true,
      })),
    },
    options: {},
  }),

  node('Needs manager?', 'n8n-nodes-base.if', 2, 1540, 300, {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
      conditions: [{
        id: uid('c'),
        leftValue: `={{ ${G('routed_to')} }}`,
        rightValue: 'manager',
        operator: { type: 'string', operation: 'equals' },
      }],
      combinator: 'and',
    },
    options: {},
  }),

  node('Email manager', 'n8n-nodes-base.gmail', 2.1, 1760, 200, {
    sendTo: MANAGER_EMAIL,
    subject: `={{ '[LawnSavers lead] Needs review: ' + ${G('name')} + ' (' + ${G('service_type')} + ')' }}`,
    emailType: 'text',
    message:
      `=A lead needs a human. No auto-reply was sent.

Name: {{ ${G('name')} }}
Email: {{ ${G('email')} }}
Phone: {{ ${G('phone')} }}
City: {{ ${G('city')} }}

Service: {{ ${G('service_type')} }}
Urgency: {{ ${G('urgency')} }}
Complaint: {{ ${G('is_complaint')} }}
Guardrail flags: {{ ${G('flags_text')} }}

AI summary: {{ ${G('summary')} }}

Original message:
{{ ${G('message')} }}

Suggested reply (NOT sent, review first):
{{ ${G('reply_draft')} }}`,
    options: { appendAttribution: false },
  }),

  node('Auto-reply customer', 'n8n-nodes-base.gmail', 2.1, 1760, 400, {
    sendTo: `={{ ${G('email')} }}`,
    subject: 'Thanks for contacting LawnSavers',
    emailType: 'text',
    message: `={{ ${G('reply_draft')} }}`,
    options: { appendAttribution: false },
  }),
];

const connections = {
  Webhook: { main: [link('Normalize')] },
  Normalize: { main: [link('Groq classify')] },
  'Groq classify': { main: [link('Guardrail')] },
  Guardrail: { main: [link('HubSpot upsert contact')] },
  'HubSpot upsert contact': { main: [link('HubSpot add note')] },
  'HubSpot add note': { main: [link('Log to Google Sheet')] },
  'Log to Google Sheet': { main: [link('Needs manager?')] },
  'Needs manager?': { main: [link('Email manager'), link('Auto-reply customer')] },
};

const leadBot = {
  name: 'LawnSavers Lead Bot',
  nodes,
  connections,
  settings: { executionOrder: 'v1' },
  pinData: {},
};

// ---------- error workflow ----------
const errorHandler = {
  name: 'LawnSavers Lead Bot - Error Handler',
  nodes: [
    node('Error Trigger', 'n8n-nodes-base.errorTrigger', 1, 0, 300, {}),
    node('Email me the error', 'n8n-nodes-base.gmail', 2.1, 220, 300, {
      sendTo: MANAGER_EMAIL,
      subject: "={{ '[n8n ERROR] ' + $json.workflow.name + ' failed at ' + ($json.execution?.lastNodeExecuted ?? 'unknown node') }}",
      emailType: 'text',
      message:
        `=Workflow: {{ $json.workflow.name }}
Failed node: {{ $json.execution?.lastNodeExecuted ?? 'unknown' }}
Error: {{ $json.execution?.error?.message ?? 'no message' }}
Execution: {{ $json.execution?.url ?? 'n/a' }}`,
      options: { appendAttribution: false },
    }),
  ],
  connections: { 'Error Trigger': { main: [link('Email me the error')] } },
  settings: { executionOrder: 'v1' },
  pinData: {},
};

fs.mkdirSync(path.join(ROOT, 'workflows'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'workflows', 'lead-bot.json'), JSON.stringify(leadBot, null, 2) + '\n');
fs.writeFileSync(path.join(ROOT, 'workflows', 'error-handler.json'), JSON.stringify(errorHandler, null, 2) + '\n');
console.log('Wrote workflows/lead-bot.json and workflows/error-handler.json');
