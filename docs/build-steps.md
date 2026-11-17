# Build steps (n8n UI)

Follow these in order. Each step ends with a ✅ check: don't move on until it passes.

## 0. Accounts and credentials (~35 min)

1. **n8n Cloud**: start the free trial at n8n.io.
2. **Groq**: console.groq.com → API Keys → create a key. Check the Models page and make sure `openai/gpt-oss-120b` is still listed. If it isn't, pick a current model and change `GROQ_MODEL` in `scripts/build-workflows.js`, then run `npm run build`.
   In n8n: **Credentials → New → Header Auth**. Name it `Groq API key`, header name `Authorization`, value `Bearer <your key>`.
3. **Google**: create a Google Sheet called `LawnSavers Leads`. Put this header row in row 1:
   `timestamp | name | email | service_type | urgency | is_complaint | needs_human | routed_to | summary`
   In n8n: **New credential → Google Sheets OAuth2 API → Sign in with Google**. Then do the same for **Gmail OAuth2**.
4. **HubSpot** (free CRM): Settings (gear) → Integrations → **Private Apps** (newer accounts may show it under *Development → Legacy apps*) → Create.
   Scopes: `crm.objects.contacts.read` and `crm.objects.contacts.write`. Copy the token.
   In n8n: **New credential → HubSpot App Token**, paste the token.

✅ Every credential shows "Connection tested successfully" (Header Auth has no test; that's fine).

## 1. Import (~10 min)

1. n8n → **Workflows → Import from file** → `workflows/error-handler.json`. On *Email me the error*, select the Gmail credential and replace `YOUR_EMAIL@gmail.com` with your address. **Save, then Activate.**
2. Import `workflows/lead-bot.json`. Open every node that shows a red warning and select its credential:
   - *Groq classify*: Header Auth → `Groq API key`
   - *HubSpot upsert contact* and *HubSpot add note*: HubSpot App Token
   - *Log to Google Sheet*: Google Sheets credential, then pick the `LawnSavers Leads` document and the sheet tab. If the column list looks empty, click the refresh icon.
   - *Email manager*: Gmail credential, and replace `YOUR_EMAIL@gmail.com`
   - *Auto-reply customer*: Gmail credential
3. Workflow **⋯ → Settings → Error workflow** → `LawnSavers Lead Bot - Error Handler`. Save.

## 2. Webhook and Normalize (~15 min)

Open the *Webhook* node and copy the **Test URL**. Click **Listen for test event**, then in PowerShell:

```powershell
.\tests\run-tests.ps1 -Url <TEST URL> -Email you@gmail.com -Case normal
```

✅ The execution shows up and *Normalize* outputs clean `name / email / city / message` fields.

> The test URL only takes **one** request per "Listen" click. To send all 5 cases, activate the workflow and use the **Production URL**.

## 3. Groq and Guardrail (~45 min)

Click **Test workflow**. Note that with a pinned or test event, nodes after the Guardrail will also run and send real emails.

✅ For each payload, the *Guardrail* output has the expected `routed_to` (see the README's test table). If Groq returns 400, the model name is probably wrong.

## 4. IF and Gmail (~25 min)

✅ The normal case sends an auto-reply to `you+normal@…`. The complaint case sends a manager alert and no auto-reply. Check your spam folder once.

## 5. HubSpot (~40 min)

✅ The contact exists with lifecycle stage **Lead**, and the note is on its timeline.
✅ Running `-Case duplicate` sends the same email twice. HubSpot still shows **one** contact, now with **two** notes.

If *HubSpot add note* fails with a 400 about the association: open the *HubSpot upsert contact* output and find the field that holds the contact ID (`vid`, `canonical-vid`, or `id`). The note body already tries all three.
If it fails with 403: add the scope that the error names to the private app.

## 6. Sheet (~15 min)

✅ One new row per run, and `routed_to` is filled in.

## 7. Error workflow (~15 min)

The error workflow only fires for **production** executions, not manual test runs.
1. Activate *LawnSavers Lead Bot*.
2. Break something on purpose. For example, edit the HubSpot credential and add `x` to the token.
3. Send `-Case normal` to the **Production URL**.

✅ The error email arrives. Then fix the credential.

(Breaking the Groq key does **not** trigger an error, by design: the Groq node continues on failure and the guardrail sends the lead to the manager with the flag `llm_call_failed`. Show that too.)

## 8. WordPress (~40 min)

1. Install LocalWP → create a site → WP Admin → Plugins → Add New → **Fluent Forms** → activate.
2. Create a form with these fields: Name, Email, Phone, City, Service (dropdown of the 7 services), Message.
3. Form → **Settings & Integrations → Webhook** (enable *Webhooks* in Fluent Forms → Integrations if you can't see it). Set:
   - Request URL: the n8n **Production URL**
   - Method: POST, Format: JSON
   - Request body: **Selected fields**, with keys exactly `name`, `email`, `phone`, `city`, `service`, `message`
4. Put the form on a page, then submit it.

✅ A new production execution appears in n8n. If the fields come through empty, open the execution, look at `body`, and fix the field keys in Fluent Forms. You can also change the expressions in *Normalize* instead.

If LocalWP can't reach n8n (SSL error in the Fluent Forms log), demo the form screen and use `run-tests.ps1` for the live run. The workflow doesn't care where the POST comes from.

## 9. Export (~15 min)

In n8n, open each workflow → **⋯ → Download**. Save the files into `exports/` (ignored by git), then:

```powershell
node scripts/sanitize-export.js exports/lead-bot.json workflows/lead-bot.json --redact-emails
node scripts/sanitize-export.js exports/error-handler.json workflows/error-handler.json --redact-emails
npm test
```

`npm test` also checks that the Guardrail code in the exported workflow still matches `src/guardrail.js`. If you edited the Code node in the UI, copy those edits back into `src/guardrail.js`.
