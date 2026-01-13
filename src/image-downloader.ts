// ABOUTME: Downloads Linear images that require authentication.
// ABOUTME: Pre-processes issue descriptions to make images accessible to Claude.

import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

export interface DownloadResult {
  success: boolean;
  localPath?: string;
  error?: string;
}

export interface ProcessResult {
  processedDescription: string;
  downloadedCount: number;
  failedCount: number;
  skippedReason?: string;
}

const LINEAR_UPLOAD_URL_PATTERN = /https:\/\/uploads\.linear\.app\/[^\s\)]+/g;

/**
 * Extracts all Linear upload URLs from a markdown description.
 * Handles both markdown image syntax and plain URLs.
 */
export function extractLinearImageUrls(description: string): string[] {
  const matches = description.match(LINEAR_UPLOAD_URL_PATTERN);
  if (!matches) {
    return [];
  }
  // Deduplicate URLs
  return [...new Set(matches)];
}

/**
 * Generates a unique local filename from a Linear upload URL.
 * Uses UUID parts from the URL path to ensure uniqueness.
 */
function generateLocalFilename(url: string): string {
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split("/").filter(Boolean);

  // URL format: /workspace-id/uuid1/uuid2/filename
  // Use uuid1 as prefix for uniqueness
  const uuid = pathParts.length >= 2 ? pathParts[1] : "unknown";
  const originalFilename = pathParts[pathParts.length - 1] || "image";

  // Extract extension from original filename
  const extMatch = originalFilename.match(/\.[a-zA-Z0-9]+$/);
  const ext = extMatch ? extMatch[0] : ".png";

  return `${uuid}-${Date.now()}${ext}`;
}

/**
 * Downloads a Linear image using the provided API key for authentication.
 * Saves the image to the destination directory.
 */
export async function downloadLinearImage(
  url: string,
  apiKey: string,
  destDir: string
): Promise<DownloadResult> {
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: apiKey,
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const imageData = await response.arrayBuffer();
    const filename = generateLocalFilename(url);
    const localPath = join(destDir, filename);

    // Ensure destination directory exists
    await mkdir(destDir, { recursive: true });
    await writeFile(localPath, Buffer.from(imageData));

    return {
      success: true,
      localPath,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Processes an issue description by downloading Linear images and replacing
 * URLs with local file paths.
 */
export async function processDescription(
  description: string,
  apiKey: string,
  destDir: string
): Promise<ProcessResult> {
  if (!apiKey) {
    return {
      processedDescription: description,
      downloadedCount: 0,
      failedCount: 0,
      skippedReason: "No API key provided",
    };
  }

  const urls = extractLinearImageUrls(description);
  if (urls.length === 0) {
    return {
      processedDescription: description,
      downloadedCount: 0,
      failedCount: 0,
    };
  }

  let processedDescription = description;
  let downloadedCount = 0;
  let failedCount = 0;

  for (const url of urls) {
    const result = await downloadLinearImage(url, apiKey, destDir);
    if (result.success && result.localPath) {
      // Replace the URL with the local path in the description
      processedDescription = processedDescription.split(url).join(result.localPath);
      downloadedCount++;
    } else {
      failedCount++;
      console.warn(`[ImageDownloader] Failed to download ${url}: ${result.error}`);
    }
  }

  return {
    processedDescription,
    downloadedCount,
    failedCount,
  };
}
