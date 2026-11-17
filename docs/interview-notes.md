# Interview notes

## Each part in plain English

- **WordPress form**: the customer-facing entry point. On submit, the form plugin sends the fields as JSON to a URL I control: a webhook. The website knows nothing about the automation behind it.
- **Webhook node**: a URL that starts the workflow whenever something POSTs to it. It replies 200 right away so the website isn't kept waiting on the AI. Test and production URLs are separate, so I can debug without touching live traffic.
- **Normalize (Set)**: maps whatever field names the form sends into one clean shape (name, email, city, message…). A phone agent or a different form can then reuse everything after it.
- **Groq classify (HTTP Request)**: a plain REST call to an LLM. It sends the lead and gets back JSON: service type, urgency, complaint or not, a summary and a draft reply. It uses JSON mode and temperature 0 so the output is predictable. The prompt limits it to LawnSavers' real services and forbids prices, discounts and dates.
- **Guardrail (Code)**: LLMs sometimes return broken JSON or get talked into things, so I never trust the output directly. This JavaScript checks the shape, and scans for prices, discounts, promised dates, prompt injection and spam. If anything looks off, a human handles the lead. It's unit-tested (18 tests), and the exact same code runs in n8n.
- **HubSpot upsert and note**: "create or update by email" means a repeat customer updates their existing contact instead of creating a duplicate. It sets lifecycle stage to Lead. The note is a v3 API call that attaches the AI summary to the contact, so sales sees the context.
- **Google Sheet log**: a simple audit trail of every lead and how it was routed. Looker Studio can chart it with no code.
- **IF routing**: complaints, urgent leads and anything the guardrail flagged go to a manager, with no auto-reply. Only clean, routine leads get an automatic answer. Automation handles the routine cases and people handle the risky ones.
- **Gmail nodes**: send the customer reply or the manager alert, using OAuth credentials stored in n8n, never passwords in the workflow.
- **Error workflow**: if any node fails (an API down, an expired credential), n8n runs a separate workflow that emails me the failed node, the error and a link to the execution. Failures aren't silent. The API nodes also retry once before failing.

## Likely questions

1. **What if the AI gives a wrong or harmful answer?**
   It can never reach a customer unchecked. JSON mode and temperature 0 make the output predictable, and the guardrail rejects anything malformed or anything mentioning money, dates or guarantees. Anything uncertain goes to a human. The worst case is that a manager gets an extra email.
2. **How do you avoid duplicate contacts?**
   HubSpot upsert keyed on email. Limitation: the same person using a different email becomes two contacts. A next step would be matching on phone number too, or using HubSpot's duplicate management.
3. **How did you handle secrets and security?**
   All keys live in n8n Credentials. Exports contain only credential names, and a sanitize script strips IDs and pinned data and refuses to write anything that looks like a key. The next step is Header Auth on the webhook so only our website can call it.
4. **What happens if HubSpot is down?**
   The node retries once. If it still fails, the error workflow emails me with a link to the execution, which I can re-run from the n8n UI. In production I'd add a queue so no lead is lost.
5. **How would you extend it?**
   A Retell AI voice agent can collect the same fields on a call and POST them to the same webhook with `source: "phone"`. Everything after Normalize stays the same. The same flow in Make.com is Webhooks → HTTP → Router → HubSpot/Sheets/Gmail modules. For volume, I'd self-host n8n in Docker with queue mode.

## Why n8n Cloud and not Docker?
Cloud gives one-click Google OAuth and a public HTTPS webhook. Self-hosting means creating your own Google Cloud OAuth app and running a tunnel. For a 2-day demo, Cloud was the faster choice. For a company, I'd self-host for cost and data control.

## Video shot list (about 2:30)

| Time | Shot |
|---|---|
| 0:00–0:15 | README title: "Website quote request → AI triage → CRM, with a human in the loop." |
| 0:15–0:35 | Pan across the n8n canvas left to right, one sentence per node. |
| 0:35–1:05 | Normal case from the WordPress form → green execution → auto-reply in inbox → HubSpot contact + note → Sheet row. |
| 1:05–1:25 | Complaint case → manager alert, no customer email. |
| 1:25–1:50 | Injection case → open the Guardrail output and show `flags` → manager alert, no discount sent. |
| 1:50–2:05 | Junk case + duplicate email sent twice → still one HubSpot contact with two notes. |
| 2:05–2:20 | Break the HubSpot token → error email arrives. |
| 2:20–2:30 | GitHub repo + `npm test` passing. Close: "Next: a Retell voice agent posting to the same webhook." |
