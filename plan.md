# Backend

backend/ClipRoom.ts.ts

Move anything related to the Service class into Service.ts

Move PlatformConnector to index.ts handles all platform specific and http /
network specific things such that it calls simple methods on service
according to its types.

PlatformConnector should create Handlers, functions that wrap a websocket
send, in order to give it to the service.

the switch statement for command should be moved to it's own route function
and be shared for post requests and websocket messages

The websocket close event should cause unsubscribe to be called

# Deploying as a Cloudflare Worker

## Prerequisites

- A Cloudflare account
- Node.js and npm installed

## Steps

1. Install dependencies

   ```
   npm install
   ```

2. Authenticate with Cloudflare

   ```
   npx wrangler login
   ```

   This opens a browser to authorize wrangler with your account.

3. Build the frontend

   ```
   npm run build
   ```

   Outputs compiled assets to `dist/`, which wrangler.toml serves via
   `[assets] directory = "../dist"`.

4. Deploy

   ```
   npx wrangler deploy --config backend/wrangler.toml
   ```

   Wrangler applies Durable Object migrations automatically on first deploy.
   The worker URL is printed on success.

## Local development

Run these two commands in separate terminals:

```
npm run dev     # vite watch — rebuilds frontend to dist/ on change
npm run worker  # wrangler dev — serves worker + assets on localhost:3000
```

The worker dev server proxies WebSocket and API requests to the local
Durable Object instance. Frontend hot-reload is handled by vite watch
writing to `dist/` which wrangler picks up on the next request.
