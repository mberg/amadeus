// ABOUTME: Tests for org_id scoping in request handling.
// ABOUTME: Verifies webhook accepts org path parameter and defaults to "default".

import { test, expect } from "bun:test";
import { getRequestOrgId } from "../src/org";

test("getRequestOrgId returns 'default' for plain webhook path", () => {
  const url = new URL("http://localhost/webhook");
  expect(getRequestOrgId(url)).toBe("default");
});

test("getRequestOrgId extracts orgId from /webhook/:orgId", () => {
  const url = new URL("http://localhost/webhook/my-org");
  expect(getRequestOrgId(url)).toBe("my-org");
});

test("getRequestOrgId returns 'default' for non-webhook paths", () => {
  const url = new URL("http://localhost/config/yaml");
  expect(getRequestOrgId(url)).toBe("default");
});

test("getRequestOrgId returns 'default' for /webhook/ with trailing slash", () => {
  const url = new URL("http://localhost/webhook/");
  expect(getRequestOrgId(url)).toBe("default");
});
