// ABOUTME: Tests for authentication middleware and utilities.
// ABOUTME: Covers simple auth mode, secure defaults, and cookie parsing.

import { describe, expect, it, test } from "bun:test";
import { getAuthContext, parseCookies } from "../src/auth";

function mockRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/test", { headers });
}

describe("getAuthContext in simple mode", () => {
  describe("when no API token is configured", () => {
    it("denies access by default", async () => {
      const req = mockRequest();
      const context = await getAuthContext(req, undefined);

      expect(context.authenticated).toBe(false);
      expect(context.mode).toBe("simple");
    });

    it("denies access even with X-Amadeus-Token header", async () => {
      const req = mockRequest({ "X-Amadeus-Token": "some-token" });
      const context = await getAuthContext(req, undefined);

      expect(context.authenticated).toBe(false);
    });
  });

  describe("when API token is configured", () => {
    const apiToken = "test-secret-token";

    it("grants admin access with valid token", async () => {
      const req = mockRequest({ "X-Amadeus-Token": apiToken });
      const context = await getAuthContext(req, apiToken);

      expect(context.authenticated).toBe(true);
      expect(context.role).toBe("admin");
      expect(context.mode).toBe("simple");
    });

    it("denies access with invalid token", async () => {
      const req = mockRequest({ "X-Amadeus-Token": "wrong-token" });
      const context = await getAuthContext(req, apiToken);

      expect(context.authenticated).toBe(false);
    });

    it("denies access with no token header", async () => {
      const req = mockRequest();
      const context = await getAuthContext(req, apiToken);

      expect(context.authenticated).toBe(false);
    });
  });
});

describe("parseCookies", () => {
  test("parses a single cookie", () => {
    expect(parseCookies("foo=bar")).toEqual({ foo: "bar" });
  });

  test("parses multiple cookies separated by '; '", () => {
    expect(parseCookies("foo=bar; baz=qux")).toEqual({ foo: "bar", baz: "qux" });
  });

  test("parses multiple cookies separated by ';' (no space)", () => {
    expect(parseCookies("foo=bar;baz=qux")).toEqual({ foo: "bar", baz: "qux" });
  });

  test("handles cookies with '=' in the value", () => {
    expect(parseCookies("foo=bar=baz")).toEqual({ foo: "bar=baz" });
    expect(parseCookies("token=abc=def=ghi")).toEqual({ token: "abc=def=ghi" });
  });

  test("handles cookies with empty values", () => {
    expect(parseCookies("foo=")).toEqual({ foo: "" });
    expect(parseCookies("foo=; bar=baz")).toEqual({ foo: "", bar: "baz" });
  });

  test("skips malformed cookies without '='", () => {
    expect(parseCookies("foo")).toEqual({});
    expect(parseCookies("foo; bar=baz")).toEqual({ bar: "baz" });
  });

  test("returns empty object for empty string", () => {
    expect(parseCookies("")).toEqual({});
  });

  test("handles whitespace around separators", () => {
    expect(parseCookies("foo=bar;  baz=qux")).toEqual({ foo: "bar", baz: "qux" });
    expect(parseCookies("foo=bar ;baz=qux")).toEqual({ "foo": "bar ", baz: "qux" });
  });

  test("handles real-world Clerk session cookie", () => {
    const jwt = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig";
    expect(parseCookies(`__session=${jwt}`)).toEqual({ __session: jwt });
  });

  test("handles multiple cookies including session", () => {
    const jwt = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig";
    const header = `__session=${jwt}; __client_uat=1234567890`;
    expect(parseCookies(header)).toEqual({
      __session: jwt,
      __client_uat: "1234567890",
    });
  });
});
