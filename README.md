# viggy_mart

viggy_mart is an Indian-food ordering MVP with a searchable catalog, category browse pages, customer accounts, persisted carts and orders, delivery-partner assignment, order status history, and authenticated live order/location updates.

## What works

- 142 seeded Indian dishes across 20 browse categories, including Biryani, North Indian, South Indian, Cake, Desserts, Dosa, Idli, Rolls, Noodles, Salad, Shawarma and Tea.
- Horizontal image-led category browse row with an item count on each category.
- Dedicated, linkable category pages such as `/category/biryani` and `/category/north-indian`.
- Persistent light/dark theme selection and Hyderabad as the default delivery city.
- Food search and ₹100–₹2,000 price filtering.
- Customer sign-up/sign-in, bcrypt password hashes, JWT authorization, cart and order history.
- PostgreSQL account, cart, order, and delivery storage when `DATABASE_URL` is configured; SQLite remains the local/dev fallback.
- Idempotent checkout with server-calculated totals and transactional persistence.
- Delivery sign-up gated by an invite code, atomic order claiming, allowed status transitions, and permission-checked order access.
- Cloudflare Turnstile sign-up verification, verified by the API before account creation.
- Authenticated Socket.IO status updates and delivery location updates; the delivery partner explicitly turns location sharing on and can stop it.
- Maps destination preview and directions link, with browser permission required before location access.

Payment gateway verification, restaurant operations, Google Places autocomplete, and a native mobile app are not implemented. Customer and delivery account records, carts, orders, order history, and delivery locations use PostgreSQL when configured; checkout records an unpaid order and does not charge a payment method.

## Local development

Requirements: Node.js 22.12.x and npm 10+.

1. Copy `.env.example` to `.env`.
2. Set `JWT_SECRET` to a private random value of at least 32 characters.
3. If customer accounts should persist to Neon, set `DATABASE_URL` to the rotated Neon pooled connection string. Never commit it, put it in `VITE_*`, or expose it in browser code. Production will refuse to start without PostgreSQL configured.
4. Set a private `DELIVERY_INVITE_CODE` if you want to enable invitation-only delivery-partner sign-up.
5. To enable optional human verification locally, configure both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. Leave both blank to keep sign-up unchallenged; production does not require Cloudflare.
6. Run `npm ci`.
7. Run `npm run dev:api` in one terminal.
8. Run `npm run dev` in another terminal and open `http://localhost:5173`.

The local database defaults to `./data/viggy-mart.sqlite`. On startup, the API creates the PostgreSQL account, catalog, cart, order, status-history, and delivery-location tables. Existing local accounts and operational records are copied into Neon without overwriting existing PostgreSQL rows; new records use PostgreSQL as the source of truth when `DATABASE_URL` is configured. Without `DATABASE_URL`, the local SQLite database is used. Do not delete a production database to reset it; configure backups and recovery in Neon.

The connection string previously pasted into chat should be considered exposed. Rotate the Neon database password in the Neon console, then configure the new pooled URL as `DATABASE_URL` in the local environment or deployment secret manager. The application does not include that pasted credential.

Delivery-partner registration is invitation-only. `GET /api/v1/auth/options` tells the client whether signup is enabled but never returns the code. Give the private `DELIVERY_INVITE_CODE` only to approved delivery partners; Render can generate it using the blueprint environment settings. The signup form asks for it only when the server has enabled delivery signup.

Human verification is optional and uses Cloudflare Turnstile only when both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are configured. The site key is returned by `GET /api/v1/auth/options`; the secret is never exposed. When configured, the API verifies registration tokens server-side. Production may run with both values unset, in which case signup does not show a verification challenge.

## Deployment to Render

The included `render.yaml` deploys the static web build and API together on Render's free Node service. The free instance has an ephemeral filesystem, so production account/cart/order persistence is provided by Neon rather than local SQLite. Create the service through Render's Blueprint flow after pushing this repository to a Git provider connected to your Render account.

The service generates `JWT_SECRET` and `DELIVERY_INVITE_CODE` on initial creation. Add the current Neon pooled connection URL as the `DATABASE_URL` secret in Render; deployment startup requires it in production. Cloudflare Turnstile secrets are not required. Copy the generated delivery invite code from the Render environment settings to onboard delivery partners. The same-origin website URL is used for the QR and API, so the QR works across Wi-Fi and mobile networks when the deployment is publicly reachable. Change the `CLIENT_ORIGIN` value in `render.yaml` if Render assigns a different service hostname.

This workspace has not been published or deployed: deployment requires access to the user's hosting account, and the supplied Git repository was empty when inspected. The Render blueprint prepares the deployment but does not create hosting credentials or a public site by itself.

## Checks

```text
npm test
npm run typecheck
npm run build
```

The API tests cover catalog counts/price filtering, authentication, persisted carts, idempotent ordering, delivery authorization and location access.

## API paths

- `GET /api/v1/health`
- `GET /api/v1/catalog`
- `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `GET /api/v1/auth/me`
- `GET /api/v1/cart`, `PUT /api/v1/cart/items/:foodId`
- `POST /api/v1/orders`, `GET /api/v1/orders`, `GET /api/v1/orders/:orderId`
- `GET /api/v1/delivery/orders`, `POST /api/v1/orders/:orderId/claim`
- `PATCH /api/v1/orders/:orderId/status`, `POST /api/v1/orders/:orderId/location`
- Socket.IO events: authenticated `order:join`, `order:updated`, and `delivery:location`.
