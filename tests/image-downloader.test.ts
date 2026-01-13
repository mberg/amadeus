// ABOUTME: Tests for the Linear image downloader module.
// ABOUTME: Verifies URL extraction, image downloading, and description processing.

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractLinearImageUrls,
  downloadLinearImage,
  processDescription,
} from "../src/image-downloader";

describe("extractLinearImageUrls", () => {
  test("extracts single Linear upload URL from markdown", () => {
    const description = "Here is a screenshot: ![image](https://uploads.linear.app/abc/def/ghi/image.png)";
    const urls = extractLinearImageUrls(description);
    expect(urls).toEqual(["https://uploads.linear.app/abc/def/ghi/image.png"]);
  });

  test("extracts multiple Linear upload URLs", () => {
    const description = `
      First image: ![img1](https://uploads.linear.app/ws1/a/b/first.png)
      Second image: ![img2](https://uploads.linear.app/ws2/c/d/second.jpg)
    `;
    const urls = extractLinearImageUrls(description);
    expect(urls).toHaveLength(2);
    expect(urls).toContain("https://uploads.linear.app/ws1/a/b/first.png");
    expect(urls).toContain("https://uploads.linear.app/ws2/c/d/second.jpg");
  });

  test("returns empty array when no Linear URLs present", () => {
    const description = "Just some text with no images";
    const urls = extractLinearImageUrls(description);
    expect(urls).toEqual([]);
  });

  test("ignores non-Linear image URLs", () => {
    const description = "![image](https://example.com/image.png) and ![other](https://uploads.linear.app/a/b/c/real.png)";
    const urls = extractLinearImageUrls(description);
    expect(urls).toEqual(["https://uploads.linear.app/a/b/c/real.png"]);
  });

  test("handles URLs in plain text (not just markdown images)", () => {
    const description = "Check this: https://uploads.linear.app/ws/uuid1/uuid2/file.png";
    const urls = extractLinearImageUrls(description);
    expect(urls).toEqual(["https://uploads.linear.app/ws/uuid1/uuid2/file.png"]);
  });

  test("handles URLs with special characters in filename", () => {
    const description = "![img](https://uploads.linear.app/ws/a/b/screenshot%202024.png)";
    const urls = extractLinearImageUrls(description);
    expect(urls).toEqual(["https://uploads.linear.app/ws/a/b/screenshot%202024.png"]);
  });

  test("deduplicates repeated URLs", () => {
    const description = `
      ![img1](https://uploads.linear.app/ws/a/b/same.png)
      ![img2](https://uploads.linear.app/ws/a/b/same.png)
    `;
    const urls = extractLinearImageUrls(description);
    expect(urls).toEqual(["https://uploads.linear.app/ws/a/b/same.png"]);
  });
});

describe("downloadLinearImage", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "linear-img-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("downloads image with authorization header and saves to destination", async () => {
    // Mock fetch to simulate Linear's response
    const originalFetch = globalThis.fetch;
    const mockImageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes

    globalThis.fetch = mock(async (url: string, options?: RequestInit) => {
      expect(options?.headers).toHaveProperty("Authorization", "lin_api_test123");
      return new Response(mockImageData, { status: 200 });
    }) as typeof fetch;

    try {
      const result = await downloadLinearImage(
        "https://uploads.linear.app/ws/a/b/test.png",
        "lin_api_test123",
        tempDir
      );

      expect(result.success).toBe(true);
      expect(result.localPath).toContain(tempDir);
      expect(result.localPath).toEndWith(".png");

      // Verify file was written
      const files = await readdir(tempDir);
      expect(files.length).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns error on 401 unauthorized", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = mock(async () => {
      return new Response("Unauthorized", { status: 401 });
    }) as typeof fetch;

    try {
      const result = await downloadLinearImage(
        "https://uploads.linear.app/ws/a/b/test.png",
        "invalid_key",
        tempDir
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("401");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns error on network failure", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = mock(async () => {
      throw new Error("Network error");
    }) as typeof fetch;

    try {
      const result = await downloadLinearImage(
        "https://uploads.linear.app/ws/a/b/test.png",
        "lin_api_test123",
        tempDir
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("generates unique filename from URL", async () => {
    const originalFetch = globalThis.fetch;
    const mockImageData = new Uint8Array([0xff, 0xd8, 0xff]); // JPEG magic bytes

    globalThis.fetch = mock(async () => {
      return new Response(mockImageData, { status: 200 });
    }) as typeof fetch;

    try {
      const result = await downloadLinearImage(
        "https://uploads.linear.app/ws/abc123/def456/screenshot.jpg",
        "lin_api_test123",
        tempDir
      );

      expect(result.success).toBe(true);
      // Filename should be based on the UUID parts to ensure uniqueness
      expect(result.localPath).toContain("abc123");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("processDescription", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "linear-process-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("replaces Linear URLs with local file paths", async () => {
    const originalFetch = globalThis.fetch;
    const mockImageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

    globalThis.fetch = mock(async () => {
      return new Response(mockImageData, { status: 200 });
    }) as typeof fetch;

    try {
      const description = "Screenshot: ![img](https://uploads.linear.app/ws/a/b/test.png)";
      const result = await processDescription(description, "lin_api_test", tempDir);

      expect(result.processedDescription).not.toContain("uploads.linear.app");
      expect(result.processedDescription).toContain(tempDir);
      expect(result.downloadedCount).toBe(1);
      expect(result.failedCount).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns original description when no Linear URLs present", async () => {
    const description = "Just plain text, no images";
    const result = await processDescription(description, "lin_api_test", tempDir);

    expect(result.processedDescription).toBe(description);
    expect(result.downloadedCount).toBe(0);
    expect(result.failedCount).toBe(0);
  });

  test("handles partial failures gracefully", async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;

    globalThis.fetch = mock(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    try {
      const description = `
        ![img1](https://uploads.linear.app/ws/a/b/success.png)
        ![img2](https://uploads.linear.app/ws/c/d/failure.png)
      `;
      const result = await processDescription(description, "lin_api_test", tempDir);

      expect(result.downloadedCount).toBe(1);
      expect(result.failedCount).toBe(1);
      // Successfully downloaded image should be replaced
      expect(result.processedDescription).toContain(tempDir);
      // Failed image URL should remain unchanged
      expect(result.processedDescription).toContain("uploads.linear.app/ws/c/d/failure.png");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("skips download when no API key provided", async () => {
    const description = "![img](https://uploads.linear.app/ws/a/b/test.png)";
    const result = await processDescription(description, "", tempDir);

    expect(result.processedDescription).toBe(description);
    expect(result.downloadedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(result.skippedReason).toContain("No API key");
  });
});
