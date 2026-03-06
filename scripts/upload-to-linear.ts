// ABOUTME: Uploads a local file to Linear's CDN via the GraphQL fileUpload mutation.
// ABOUTME: Outputs the public asset URL to stdout for embedding in comments.

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: bun scripts/upload-to-linear.ts <file-path>");
  process.exit(1);
}

const apiKey = process.env.LINEAR_API_KEY ?? process.env.LINEAR_TOKEN;
if (!apiKey) {
  console.error("LINEAR_API_KEY or LINEAR_TOKEN must be set");
  process.exit(1);
}

const file = Bun.file(filePath);
if (!(await file.exists())) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const size = file.size;
const contentType = file.type || "image/png";
const filename = filePath.split("/").pop() ?? "screenshot.png";

// Step 1: Request a signed upload URL from Linear
const mutation = `
  mutation FileUpload($size: Int!, $contentType: String!, $filename: String!) {
    fileUpload(size: $size, contentType: $contentType, filename: $filename, makePublic: true) {
      success
      uploadFile {
        uploadUrl
        assetUrl
        headers {
          key
          value
        }
      }
    }
  }
`;

const gqlResponse = await fetch("https://api.linear.app/graphql", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: apiKey,
  },
  body: JSON.stringify({
    query: mutation,
    variables: { size, contentType, filename },
  }),
});

if (!gqlResponse.ok) {
  console.error(`Linear API error: ${gqlResponse.status} ${gqlResponse.statusText}`);
  process.exit(1);
}

const gqlData = await gqlResponse.json();
const uploadPayload = gqlData?.data?.fileUpload;

if (!uploadPayload?.success || !uploadPayload?.uploadFile) {
  console.error("Failed to get upload URL from Linear:", JSON.stringify(gqlData.errors ?? gqlData));
  process.exit(1);
}

const { uploadUrl, assetUrl, headers } = uploadPayload.uploadFile;

// Step 2: Upload the file to the signed URL
const uploadHeaders: Record<string, string> = {};
for (const h of headers) {
  uploadHeaders[h.key] = h.value;
}
// Ensure content type and content length are set
uploadHeaders["Content-Type"] = contentType;

const fileData = await file.arrayBuffer();
const uploadResponse = await fetch(uploadUrl, {
  method: "PUT",
  headers: uploadHeaders,
  body: fileData,
});

if (!uploadResponse.ok) {
  console.error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
  process.exit(1);
}

// Step 3: Output the public asset URL
console.log(assetUrl);
