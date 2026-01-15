// ABOUTME: Tests for authentication utilities including cookie parsing.
// ABOUTME: Validates robust handling of edge cases in cookie headers.

import { describe, expect, test } from "bun:test";
import { parseCookies } from "../src/auth";

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
