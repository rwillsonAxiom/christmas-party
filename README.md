# Credit Cards

Named credit accounts, printable QR cards, a public viewer, and a staff camera
scanner. The frontend deploys to **GitHub Pages**; our API runs in a **Supabase
Edge Function** and stores accounts, sessions and retry receipts in
**PostgreSQL**. There is no Supabase SDK or database credential in the browser.

## Everyday use

- Visitors scan their card with the phone camera to open the public balance
  page.
- Staff choose **Staff sign in** and enter the shared password once per device.
- For a queue of people, choose **Scan cards → Start camera**. Scan a card,
  check the name and balance, press **Add 1** or **Remove 1**, then **Scan next
  card**. The camera stays open and the page does not reload between cards.
- Scanning never changes credits automatically. The displayed account remains
  selected until staff request the next scan. An uncertain change must be
  retried before using the next-card button.
- Camera permission is requested only after pressing Start camera. Stop camera,
  leaving the scan screen, or signing out releases the camera. No images are
  uploaded. Camera scanning needs HTTPS or localhost; plain HTTP on a phone's
  LAN address will not support camera access. GitHub Pages supplies HTTPS.
- Staff can create accounts and print individual cards or all cards. Names and
  balances are public. Account creation and credit updates require a session.

## First deployment: GitHub Pages and Supabase Free

Use the contents of **this `credit-cards` directory as the repository root**.
The included workflows expect `.github/`, `deno.json` and `supabase/` at the
root, not nested inside the existing Secret Santa repository. No repository has
been created or pushed by this setup.

1. Create a public GitHub repository with default branch `main` and commit this
   directory's contents. Public repositories support GitHub Pages on GitHub
   Free. Keep the existing ignore rules: `.env`, `data/` and generated builds
   stay out.
2. Create a Supabase **Free** project. Retain the project reference and database
   password. Do not upgrade the plan or enable paid add-ons for this setup.
3. In Supabase's Edge Function secrets, set these once:

   | Secret             | Value                                                                                                                                        |
   | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
   | `APP_DATABASE_URL` | PostgreSQL transaction-pooler connection string from **Connect**, port 6543. Include the database password, URL-encoding special characters. |
   | `STAFF_PASSWORD`   | A long password shared only with trusted staff.                                                                                              |

4. In GitHub **Settings → Secrets and variables → Actions**, add:

   | Kind     | Name                    | Value                                                                     |
   | -------- | ----------------------- | ------------------------------------------------------------------------- |
   | Secret   | `SUPABASE_ACCESS_TOKEN` | Supabase personal access token permitted to link and deploy this project. |
   | Secret   | `SUPABASE_DB_PASSWORD`  | The project's database password.                                          |
   | Variable | `SUPABASE_PROJECT_REF`  | The project reference, without a hostname.                                |

5. In GitHub **Settings → Pages**, choose **GitHub Actions** as the publishing
   source. Push to `main`, or run **Deploy Pages and Supabase** on `main`.

The workflow runs type checks, real PostgreSQL integration tests, scanner tests
and a static build. After they pass, it applies migrations, sets `PUBLIC_URL`
from GitHub Pages configuration, deploys the `credit-cards` function, and
publishes the static site. Pull requests and other branches run checks without
deployment. `PUBLIC_URL` must retain the repository path, for example
`https://your-name.github.io/credit-cards`.

The production API base address is:

```text
https://PROJECT_REF.supabase.co/functions/v1/credit-cards
```

Only `dist/` is uploaded to Pages. The generated `dist/config.js` contains that
public API address and no secrets. Our function intentionally sets
`verify_jwt = false`: anonymous viewers use public reads, and staff writes are
protected by our own opaque bearer sessions, rather than Supabase JWTs.

The setup targets free plans, not expiring paid trials. Usage remains subject to
their free quotas. Supabase Free can pause after a week of low activity; restore
the project before an occasional event. Free-tier terms can change. No paid
services, custom domains or keep-alive jobs are configured.

## Local development and F5

Install Deno and PostgreSQL server tools once. PostgreSQL is already installed
on this workstation. The tools can be on `PATH`, in a standard Windows
`Program Files/PostgreSQL/<version>/bin` directory, or specified by
`POSTGRES_BIN`.

Open `credit-cards.code-workspace` and press **F5**, then visit
`http://localhost:8000`. F5 automatically:

1. Builds the scanner.
2. Creates and starts a dedicated PostgreSQL cluster in `data/dev-postgres`,
   bound to `127.0.0.1:15433`.
3. Creates `credit_cards_dev` and applies any pending migrations, with checksum
   tracking to avoid reapplying or silently changing existing migrations.
4. Starts the app using that database. Existing accounts persist across
   restarts.

The regular PostgreSQL service, existing databases, `.env` connection string and
Supabase project are unaffected. F5 uses the managed local database even when
`.env` contains an external `APP_DATABASE_URL`. No database password is needed
for this loopback-only development cluster. No `.vscode` directory is created.

If `.env` supplies `STAFF_PASSWORD`, local login uses it. Otherwise the local
staff password is **`local-dev`**. The default password is confined to `dev.ts`;
the configured/hosted server still disables staff login when no password is set.

**Shift+F5** stops the app and its local PostgreSQL instance, retaining the
data. From a terminal, use `deno task dev` to launch the same setup and
`deno task
dev:stop` to stop its database after finishing.
`deno task dev:prepare` can run database setup alone. `deno task test:local`
automatically provisions a separate test database and runs the tests without
affecting development accounts.

`DEV_DATABASE_PORT` overrides `15433`; stop the cluster before changing its
port. `DEV_PUBLIC_URL` overrides the local frontend URL, for example a
computer's LAN address for phone viewing. `PORT` and `HOST` still default to
`8000` and `0.0.0.0`. In-app phone camera testing requires HTTPS; localhost
camera testing works on the computer.

For explicitly configured PostgreSQL/Supabase connections, set `.env` with
`APP_DATABASE_URL`, `STAFF_PASSWORD` and `PUBLIC_URL`, apply migrations to that
database, and run `deno task start`. This path does not provision or alter a
database automatically. Hosted database migrations remain in the GitHub
workflow.

## Bringing existing Deno KV accounts across

The original `data/credits.kv` file is retained and ignored by Git. After
applying the PostgreSQL migration, stop the old server, point `.env` at the
intended database, and run:

```powershell
deno task import:kv
```

This imports accounts and retry receipts in a single transaction. It preserves
account UUIDs, leaves existing PostgreSQL account balances unchanged on repeated
runs, and retains the KV file. Staff sessions are not imported; sign in again.
New printed cards use GitHub Pages hash routes. Old local `/a/` card links still
refer to their old host; the in-app scanner can read their account IDs, but
normal phone-camera navigation needs reprinted cards for the hosted site.

## API boundary and portability

The browser uses ordinary JSON requests, not Supabase's Data API:

| Method | Path                         | Access                                                  |
| ------ | ---------------------------- | ------------------------------------------------------- |
| GET    | `/api/accounts`              | Public account list                                     |
| GET    | `/api/accounts/{id}`         | Public name and balance                                 |
| GET    | `/api/accounts/{id}/qr`      | Public QR image pointing to the frontend                |
| POST   | `/api/login`                 | Password; returns `token`, `expiresAt`, `authenticated` |
| GET    | `/api/session`               | Returns whether the supplied bearer token is valid      |
| POST   | `/api/logout`                | Revokes the supplied session                            |
| POST   | `/api/accounts`              | Staff; `{name, balance}`                                |
| POST   | `/api/accounts/{id}/credits` | Staff; `{delta: 1 or -1, requestId: UUID}`              |

Staff requests send `Authorization: Bearer TOKEN`. The frontend stores this
token in local storage so staff remain signed in across cards/tabs; never store
the password or put tokens in QR codes. Sessions expire after 12 hours. Sign out
revokes the server record and clears the browser token. Changing the password
and redeploying invalidates existing sessions. Tokens are stored as
password-bound hashes in PostgreSQL. Login attempts are limited to 30 per minute
server-wide.

CORS permits the configured frontend origin. It is a browser restriction, not
the authorisation check: every protected endpoint checks the session itself.
GitHub Pages repository paths share one origin, so host only trusted code under
the same GitHub account. The frontend has a Content Security Policy and renders
names as text. The database uses a private schema and has no browser-accessible
policies. Keep it out of Supabase's exposed schemas.

Database queries live in `supabase/functions/_shared/store.ts` and `auth.ts`.
The PostgreSQL adapter is `database.ts`; only `credit-cards/index.ts` knows
about Supabase's function routing. Row locks, constraints and operation receipts
prevent lost updates, negative balances, and duplicate application of retries.

To move providers, export/import the `credit_cards` schema, run the API behind a
new HTTPS address with the same secrets, and rebuild Pages with a new
`API_BASE_URL`. QR URLs remain unchanged while the Pages address stays the same.
Sessions can move with the database and password, though changing the API
address will require sign-in again because browser tokens are scoped to the API
address.

## Verification and QR dependency review

For the explicitly configured server, if the browser reports a database failure,
run `deno task diagnose` from this directory. It loads `.env`, checks
connectivity and the migration, and prints redacted error details. PostgreSQL
error `28P01` means the configured login was rejected; replace the example
password in `APP_DATABASE_URL` with the actual database password, then restart
F5.

```powershell
deno task check
$env:TEST_DATABASE_URL = "postgresql://postgres:password@127.0.0.1:5432/credit_cards_test"
deno task test
$env:API_BASE_URL = "https://PROJECT_REF.supabase.co/functions/v1/credit-cards"
deno task build
```

Create the test database first. Tests require a database name ending in `_test`
and replace only its `credit_cards` schema. They cover real concurrent
PostgreSQL transactions, safe retries, validation, authentication, revocation,
expiry, CORS, QR encoding/decoding, malformed decoder inputs and untrusted scan
contents.

QR generation and decoding use **`jsr:@paulmillr/qr@0.7.2`**, pinned and
recorded in `deno.lock`. The camera module bundles locally into
`public/scanner.js`, then ships with the static site; no QR code CDN is loaded
in the browser. Its license ships in `qr-LICENSE.txt`. See
`dependency-review.txt` for source-review scope, findings, integration
precautions and the exact source hashes reviewed.

Physical phone-camera behavior and permission prompts still need a test on the
deployed HTTPS site. The API and QR decoder tests do not simulate phone
hardware.
