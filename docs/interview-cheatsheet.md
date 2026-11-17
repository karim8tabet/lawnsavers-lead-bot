# Interview Cheat Sheet: LawnSavers Lead Bot

## 1. One-sentence version
> "The form POSTs JSON to an n8n webhook. An LLM classifies the request and drafts a reply, a JavaScript guardrail validates the output, the contact is upserted into HubSpot and logged to Google Sheets, and an IF node either auto-replies or alerts a manager."

## 2. Full explanation (with technical terms)
When someone submits the quote form on the website, the form sends an **HTTP POST request** with the data as **JSON** to my n8n workflow's **webhook URL**. n8n immediately responds with **200 OK**, so the customer isn't kept waiting.

Next, a **Set node** normalizes the fields into a standard format. Then an **HTTP Request node** calls the **Groq API** (an **LLM**) using **JSON mode** and **temperature 0**. It classifies the request (service type, urgency, whether it's a complaint) and drafts a reply.

LLM output can't be fully trusted, so a **Code node** written in **JavaScript** acts as a **guardrail**. It **parses and validates the JSON**, and flags anything that mentions prices or dates, looks like **prompt injection**, or is spam. Then it decides where the lead goes.

The workflow then **upserts** the contact in **HubSpot** (the **CRM**) by email, so there are no duplicates. It sets them as a **Lead** and adds a note through HubSpot's **API**. It also appends a row to a **Google Sheet** as a log.

An **IF node** routes the lead. Normal requests get an automatic reply through the **Gmail node**. Complaints, urgent requests, and anything **flagged** go to a manager instead.

All API keys are stored as **n8n credentials**, not in the code. A separate **error workflow** emails me if any step fails.

## 3. Terms in one line each
| Term | Meaning |
|---|---|
| **Node** | One step (one box) in an n8n workflow. Each node does one job and passes its data to the next. |
| **Webhook URL** | The address the workflow listens on. Sending data to it starts the workflow. |
| **HTTP request** | How computers talk over the web: URL + method (GET/POST) + headers (e.g. the API key) + body (JSON). |
| **200 OK** | The status code meaning "received, success". It goes back to the sender, not the customer's screen. |
| **API** | A way for programs to exchange data over HTTP. |
| **JSON** | The text format for data: `{"name": "Jordan"}`. |
| **LLM** | Large language model: the AI (Groq, model `openai/gpt-oss-120b`). |
| **Guardrail** | Code that checks the AI's output before it's used. |
| **Prompt injection** | A user trying to trick the AI with instructions ("ignore your rules…"). |
| **CRM** | The customer database (HubSpot). |
| **Lead** | A potential customer who has shown interest. |
| **Upsert** | Update the record if it exists, create it if not. This prevents duplicates. |
| **Credential** | A key or login stored securely in n8n, never in the workflow file. |

## 4. Likely questions and answers

**Walk me through your project.**
Use the one-sentence version, then explain the guardrail and the routing. Mention that all 5 test cases passed.

**What if the AI gives a wrong or harmful answer?**
It never reaches the customer unchecked. Temperature 0 and JSON mode make the output predictable, and the guardrail blocks anything malformed or anything with prices, dates, or guarantees. Anything uncertain goes to a manager. The worst case is an extra manager email.

**How did you stop duplicate contacts?**
HubSpot upsert by email. Sending the same email twice gave one contact with two notes. The limitation is that the same person with a different email becomes a second contact.

**How did you handle API keys?**
They're stored as n8n credentials, not in the workflow. Before pushing to GitHub, a sanitize script removes IDs, test data, and emails, and refuses to save if anything looks like a key.

**What if HubSpot or Groq goes down?**
Each one retries once. If Groq still fails, the guardrail sends the lead to a manager. If HubSpot fails, the error workflow emails me a link to that run so I can re-run it.

**How did you test it?**
I wrote 18 unit tests for the guardrail with fake AI responses. Then I ran 5 end-to-end cases (normal, complaint, prompt injection, junk, duplicate) with a PowerShell script that POSTs to the live webhook, and checked Gmail, HubSpot, and the Sheet.

**Why n8n instead of coding it all in Python?**
Built-in connectors, secure credential storage, a log of every run, and a visual flow non-developers can follow. I still wrote code where it mattered: the guardrail, with tests.

**How would you do this in Make.com?**
The same building blocks: a Webhooks module, an HTTP module for the AI, a Router instead of the IF node, then the HubSpot, Google Sheets, and Gmail modules.

**How would you add Retell AI?**
A Retell voice agent collects the same info on a phone call and POSTs it to the same webhook. The Normalize step makes it fit, and everything after that is reused.

**Have you used n8n / HubSpot / WordPress before?**
"Not before this week. I learned n8n and HubSpot by building this. The WordPress form would just POST to the same webhook, and I tested that path with a script that sends the same data."

**What would you improve?**
Skip saving obvious spam to HubSpot, add authentication on the webhook, add a queue for outages, and build a Looker Studio dashboard on the Sheet.

## 5. Debugging stories (problem → how I found it → fix)

1. **The Groq model was retired.** Every lead was going to the manager with the flag `llm_call_failed`. The error on the Groq node said `model_not_found`. Groq's deprecations page showed the model had been shut down, so I switched to the replacement, `openai/gpt-oss-120b`. **Takeaway:** the guardrail did its job. A broken AI didn't crash anything or send a bad reply.
2. **Invalid header error (`ERR_INVALID_HTTP_TOKEN`).** The Groq call failed because the header *name* field had an invalid character. It has to be exactly `Authorization`, with the key in the value as `Bearer <key>`.
3. **HubSpot "authorization failed".** I had typed `Bearer` before the HubSpot token, but n8n's HubSpot credential adds `Bearer` automatically, so HubSpot received "Bearer Bearer". I pasted the token on its own and it worked.
4. **The Google Sheet step failed.** The header row had `needs_human` twice. Column names must be unique, so I removed the duplicate and re-mapped the columns.
5. **Emails bounced with "address not found".** The bounce message named the address. The test was still using a placeholder email, so I ran it with my real one.
