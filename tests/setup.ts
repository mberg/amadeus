// ABOUTME: Test setup file that runs before all tests.
// ABOUTME: Sets environment variables to avoid port conflicts.

// Clear Clerk env vars to test simple auth mode by default
// Tests that need Clerk can set these explicitly
delete process.env.CLERK_SECRET_KEY;
delete process.env.CLERK_PUBLISHABLE_KEY;

// Set PORT to avoid conflict with running Amadeus instances
process.env.PORT = "15679";

// Set other required env vars for tests
process.env.LINEAR_WEBHOOK_SECRET = "test-secret";
process.env.LINEAR_WORKSPACE = "test-workspace";
process.env.LINEAR_API_KEY_ONA = "test-api-key";
process.env.LINEAR_WEBHOOK_SECRET_ONA = "test-secret";

// Set API token for auth tests
process.env.AMADEUS_API_TOKEN = "test-api-token-12345";
