// ABOUTME: Better Auth server instance for session-based authentication.
// ABOUTME: Exports null when BETTER_AUTH_SECRET is not set (standalone mode).

import { betterAuth } from "better-auth";
import { Pool } from "pg";

const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

function createAuth() {
  if (!BETTER_AUTH_SECRET || !DATABASE_URL) {
    return null;
  }

  const baseURL = process.env.BETTER_AUTH_URL;

  return betterAuth({
    database: new Pool({ connectionString: DATABASE_URL }),
    secret: BETTER_AUTH_SECRET,
    baseURL,
    trustedOrigins: baseURL ? [baseURL] : [],
    emailAndPassword: {
      enabled: true,
    },
    socialProviders: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      },
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 300,
      },
    },
  });
}

export const auth = createAuth();
export type Auth = typeof auth;
