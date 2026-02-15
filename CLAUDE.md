---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## Machine Setup

To set up a new machine for running agents, use the setup script:

```bash
bun scripts/setup-machine.ts
```

### Running the Machine Server

```bash
# Foreground (interactive)
bun run dev

# Background with logs
bun run dev >> /tmp/amadeus.log 2>&1 &

# Watch logs
tail -f /tmp/amadeus.log
```

See README.md for full hub, cloud, and deployment documentation.

## Sprites (Remote Execution)

Amadeus can forward webhooks to [Sprites](https://sprites.dev/) VMs for isolated agent execution.

### Setup

```bash
# Install Sprites CLI
curl -fsSL https://sprites.dev/install.sh | bash

# Authenticate with your token
sprite auth setup --token "org/123/token-id/token-value"

# Or add token to .env
SPRITES_TOKEN=org/123/token-id/token-value
```

### Managing Sprites

```bash
# List sprites
sprite list

# Create a new sprite
sprite exec -s <sprite-name> -- <command>

# Open interactive console
sprite console -s <sprite-name>

# Run command on sprite
sprite exec -s <sprite-name> -- ls -la

# Use HTTP mode if websocket fails
sprite exec -s amadeus-zonewise -http-post -- <command>
```

### Provisioning a Sprite

```bash
# Use the provisioning script
bun scripts/provision-sprite-api.ts <sprite-name> [project-repo-url]

# Example
bun scripts/provision-sprite-api.ts amadeus-zonewise https://github.com/mberg/timehopper
```

### SSH Keys for GitHub

```bash
# Generate SSH key on sprite
bun scripts/setup-sprite-ssh.ts <sprite-name>

# Add the output public key to GitHub Settings > SSH Keys
```

### Sprite Config

On the sprite, set `runtimeMode: sprite` in amadeus.config.yaml:

```yaml
global:
  runtimeMode: sprite
  port: 8080
```

### Claude Login on Sprite

Sprites need Claude authentication:

```bash
sprite console -s <sprite-name>
claude login
```
