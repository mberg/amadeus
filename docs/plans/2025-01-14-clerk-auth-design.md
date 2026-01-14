# Clerk Authentication Design

## Overview

Add Clerk authentication to Amadeus for secure remote access, with role-based permissions.

## Operating Modes

### Simple Mode (default, no Clerk configured)
- No user authentication required
- Optional `X-Amadeus-Token` header for API protection
- Settings page is read-only
- Agent messaging controlled by `security.enableAgentMessaging` (default: false)

### Clerk Mode (when `CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` set)
- Full user authentication via Clerk
- Three roles: Viewer, Operator, Admin
- API token auth disabled (Clerk handles everything)
- Role assigned via Clerk user metadata (`role: admin|operator|viewer`)

## Role Permissions

| Action | Viewer | Operator | Admin |
|--------|--------|----------|-------|
| View dashboard | Yes | Yes | Yes |
| View agent status | Yes | Yes | Yes |
| View task history | Yes | Yes | Yes |
| Message agents | No | Yes | Yes |
| Stop/delete agents | No | Yes | Yes |
| Edit config | No | No | Yes |

## Backend Implementation

### New Dependencies
- `@clerk/clerk-sdk-node` - Server-side auth verification

### Auth Module (`src/auth.ts`)
- `getAuthMode()` - Returns 'clerk' | 'simple' based on env vars
- `requireAuth(role?)` - Middleware for route protection
- `getUserRole()` - Extracts role from Clerk user metadata

### Protected Endpoints
| Endpoint | Required Role |
|----------|--------------|
| `GET /config` | viewer |
| `GET /status` | viewer |
| `POST /config` (new) | admin |
| `POST /trigger` | operator |
| `POST /agents/:port/message` | operator |
| `DELETE /agents/:port` | operator |
| `POST /webhook` | none (HMAC verified) |

### Config Hot Reload
- New `POST /config` endpoint accepts YAML content
- Validates with Zod schema before applying
- Updates in-memory config without server restart
- Returns validation errors if invalid

## Frontend Implementation

### New Dependencies
- `@clerk/clerk-react` - React auth components

### Components
- `ClerkProvider` wrapper (when Clerk configured)
- `UserMenu` - Avatar, role badge, sign out (sidebar footer)
- `SignInPage` - Clerk sign-in wrapper
- `SettingsPage` - Config editor for admins

### Settings Page (Admin only in Clerk mode)
- Tab 1: Structured settings UI (realms, projects, global settings)
- Tab 2: YAML editor with syntax highlighting
- "Save & Apply" button with validation feedback

### Simple Mode UI
- No sign-in required
- No user menu
- Settings page read-only
- Agent controls based on `enableAgentMessaging` setting

## Configuration

### New Security Section
```yaml
security:
  enableAgentMessaging: false  # Allow agent interaction without auth (simple mode only)
```

### Environment Variables
```
CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
```

## Files to Modify/Create

### New Files
- `src/auth.ts` - Auth middleware and role checking
- `src/dashboard/components/UserMenu.tsx` - User menu component
- `src/dashboard/components/SettingsPage.tsx` - Config editor
- `src/dashboard/components/SignInPage.tsx` - Sign-in wrapper

### Modified Files
- `src/server.ts` - Auth middleware, `POST /config` endpoint
- `src/config-loader.ts` - `reloadConfig()` function
- `src/config-schema.ts` - Security section in schema
- `src/dashboard/App.tsx` - ClerkProvider, settings routing
- `src/dashboard/components/Sidebar.tsx` - User menu, settings nav
- `package.json` - Clerk dependencies

### Config Files
- `amadeus.config.yaml` - Document security section
- `amadeus.config.example.yaml` - Example security config
- `.env.example` - Clerk env vars

## Webhook Handling

Linear webhooks bypass Clerk auth entirely - they continue to use existing HMAC signature verification.
