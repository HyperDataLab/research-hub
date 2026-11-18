# Research Hub

A Next.js research workspace using HyperDataLab SSO for identity, a Cloudflare Worker for project and file APIs, Cloud Firestore for project metadata, and private Cloudflare R2 storage for file content. The Worker validates the SSO identity and uses a server-side Google service account for Firestore; the SSO flow does not issue Firebase tokens.

## Included

- Authenticated workspace with a left sidebar and separate `/projects` and `/files` pages; `/` opens the projects page.
- Next.js App Router file library with upload, list, download, and delete.
- SSO-owned research projects with stable IDs, stored in Firestore for future Research Hub modules.
- OAuth Authorization Code + PKCE for a browser-only **Public** SSO client.
- Strict email eligibility: `email_verified` must be `true` and the full address must end exactly in `@hyperdatalab.org`.
- Worker rechecks the SSO token and email on every file API call; R2 keys are separated by the stable SSO `sub`.
- Upload limit: 25 MB per file. Downloads are forced to attachments.
- Visual system follows HyperData Lab: Manrope, the shared blue palette, and clear keyboard focus states.
- API contract at `worker/openapi.yaml`.

## 1. Register the SSO client

In ResearchPulse, open **Admin → Connected applications** and register this as a **Public** client. Do not create or use a client secret in the browser. Request the minimum scopes `email profile`.

For local development, register the exact callback URL:

```text
http://localhost:3000/auth/callback
```

Copy the resulting `client_id` into `NEXT_PUBLIC_HYPERDATALAB_SSO_CLIENT_ID` in `.env.local`. This workspace's local environment has the client ID configured; for a fresh checkout, set it yourself. The local callback is `http://localhost:3000/auth/callback`.

## 2. Configure the frontend

This workspace has `.env.local` populated with the Firebase Web app values provided for this project. For a fresh checkout, copy `.env.example` to `.env.local`, fill in the Firebase values, then set the SSO client ID and the exact callback registered in ResearchPulse.

The Firebase Web API key is public client configuration. No Firebase Anonymous Auth provider is needed for SSO or R2 access.

## 3. Configure Firestore and R2

Enable Cloud Firestore in the Firebase project shown by `FIREBASE_PROJECT_ID` in `worker/wrangler.jsonc`. Create a Google Cloud service account for the Worker and grant it the **Cloud Datastore User** (`roles/datastore.user`) role on that project. Generate a JSON key and keep its private key out of source control. Firestore is accessed only through the authenticated Worker; the Worker enforces per-owner access using the verified SSO subject. Do not expose the service account key or make project documents publicly readable.

For local development, copy `worker/.dev.vars.example` to `worker/.dev.vars` and fill it with the service account email and private key from the downloaded JSON key. `worker/.dev.vars` is gitignored:

```dotenv
FIREBASE_CLIENT_EMAIL=your-worker-service-account@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

The project ID is configured in `worker/wrangler.jsonc`. Install dependencies and Wrangler, then create the private R2 bucket:

This checkout also includes the Firebase Admin SDK key file in the project root. To load it without copying the private key manually, run `npm run worker:secrets:local`. To load the same credentials locally and upload them as Cloudflare Worker secrets, run `npm run worker:secrets:deploy`. The command verifies that the service account belongs to the configured Firebase project and never prints the key. Service-account JSON files are gitignored.

Each project opens a workspace with PaperLab and Writing Lab launch cards. Configure `NEXT_PUBLIC_PAPERLAB_URL` and `NEXT_PUBLIC_WRITING_LAB_URL` in `.env.local` when those tools have reachable URLs; Research Hub appends the stable `projectId` query parameter. Until configured, the cards remain visible but marked as not connected.

```powershell
npm install
npx wrangler login
npx wrangler r2 bucket create research-hub-files
```

The bucket name must match `bucket_name` in `worker/wrangler.jsonc`. `SSO_BASE_URL` points to the ResearchPulse Worker. Add your frontend origin to `ALLOWED_ORIGINS` before deploying this Worker.

## 4. Run locally

Start the Worker and Next.js app in separate terminals:

```powershell
npm run worker:dev
npm run dev
```

Open `http://localhost:3000`. Wrangler serves the file Worker at `http://127.0.0.1:8787`; `.env.local` points the frontend there. The R2 bucket must exist in your Cloudflare account for remote deployment; Wrangler's local R2 emulator can be used during development.

## 5. Deploy

Set the Worker secrets and deploy it. Use the same service account identity as local development; store the private key only as a Cloudflare secret:

```powershell
npx wrangler secret put FIREBASE_CLIENT_EMAIL --config worker/wrangler.jsonc
npx wrangler secret put FIREBASE_PRIVATE_KEY --config worker/wrangler.jsonc
npm run worker:deploy
```

Update `ALLOWED_ORIGINS` in `worker/wrangler.jsonc` to the deployed frontend origin. Project records are private to the SSO subject that created them; project sharing and file association are not part of this first version.

Set `NEXT_PUBLIC_FILE_API_URL` to the deployed file Worker URL and `NEXT_PUBLIC_HYPERDATALAB_SSO_CALLBACK_URL` to the exact callback registered for the Public SSO client, then redeploy the frontend. The R2 bucket remains private and is accessed only through the Worker binding.

## File API

Every route requires `Authorization: Bearer <HyperDataLab SSO access token>`. The Worker validates it by calling the SSO `/oauth/userinfo` endpoint and rejects unverified or non-organization emails.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/projects` | List projects owned by the signed-in SSO subject |
| `POST` | `/api/projects` | Create a project for the signed-in SSO subject |
| `GET` | `/api/files` | List the signed-in user's files |
| `POST` | `/api/files` | Upload raw file bytes; filename goes in `X-File-Name` |
| `GET` | `/api/files/{id}` | Download a file owned by this SSO subject |
| `DELETE` | `/api/files/{id}` | Delete a file owned by this SSO subject |

The SSO access token lasts one hour and has no refresh token. The SPA keeps the session in tab-scoped `sessionStorage` so reloading the page does not require another login; users must sign in again after the token expires or the tab is closed. Sign-out revokes the token and clears the stored session. The short-lived PKCE state and verifier are also kept in `sessionStorage` for the callback round-trip.
