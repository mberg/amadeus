// ABOUTME: CLI chat interface for testing Claude Code via agentapi.
// ABOUTME: Spawns an agent and provides interactive message passing.

import { spawn, type Subprocess } from "bun";
import * as readline from "readline";

const PORT = process.env.AGENTAPI_PORT ? parseInt(process.env.AGENTAPI_PORT) : 8001;
const PROJECT_PATH = process.env.PROJECT_PATH || process.cwd();

let agentProcess: Subprocess | null = null;
let lastMessageCount = 0;

async function startAgent(): Promise<void> {
  console.log(`Starting agentapi on port ${PORT}...`);
  console.log(`Working directory: ${PROJECT_PATH}`);

  agentProcess = spawn({
    cmd: [
      "agentapi",
      "server",
      "claude",
      "--port",
      String(PORT),
      "--",
      "--dangerously-skip-permissions",
    ],
    cwd: PROJECT_PATH,
    stdout: "ignore",
    stderr: "ignore",
  });

  // Wait for server to be ready
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/status`);
      if (res.ok) {
        console.log("agentapi server ready.");
        return;
      }
    } catch {
      // Not ready yet
    }
    await Bun.sleep(500);
  }
  throw new Error("Agent failed to start");
}

async function waitForStable(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`http://localhost:${PORT}/status`);
    const data = await res.json();
    if (data.status === "stable") return;
    await Bun.sleep(500);
  }
  throw new Error("Agent never became stable");
}

async function acceptPermissionsPrompt(): Promise<void> {
  // Wait a moment for initial output
  await Bun.sleep(1000);

  const res = await fetch(`http://localhost:${PORT}/messages`);
  const data = await res.json();

  if (data.messages?.length > 0) {
    const lastMsg = data.messages[data.messages.length - 1];
    if (lastMsg.content?.includes("Yes, I accept")) {
      console.log("Accepting permissions prompt...");
      await fetch(`http://localhost:${PORT}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "2", type: "raw" }),
      });

      // Wait for Claude Code to fully initialize
      console.log("Waiting for Claude Code to initialize...");
      await waitForStable();

      // Update message count after initialization
      const newRes = await fetch(`http://localhost:${PORT}/messages`);
      const newData = await newRes.json();
      lastMessageCount = newData.messages?.length || 0;
    }
  }
}

async function getStatus(): Promise<string> {
  const res = await fetch(`http://localhost:${PORT}/status`);
  const data = await res.json();
  return data.status;
}

async function sendMessage(content: string): Promise<void> {
  await fetch(`http://localhost:${PORT}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, type: "user" }),
  });
}

async function pollForResponse(): Promise<string> {
  // Wait for agent to start processing (transition from stable to running)
  let waitCount = 0;
  while (waitCount < 10) {
    const status = await getStatus();
    if (status === "running") break;
    await Bun.sleep(200);
    waitCount++;
  }

  // Poll until agent is done
  process.stdout.write("Working");
  let status = await getStatus();
  while (status === "running") {
    process.stdout.write(".");
    await Bun.sleep(500);
    status = await getStatus();
  }
  console.log(" done.");

  // Get new messages
  const res = await fetch(`http://localhost:${PORT}/messages`);
  const data = await res.json();

  const allMessages = data.messages || [];
  const newMessages = allMessages.slice(lastMessageCount);
  lastMessageCount = allMessages.length;

  // Extract agent responses only
  const responses = newMessages
    .filter((m: { role: string }) => m.role === "agent")
    .map((m: { content: string }) => cleanTerminalOutput(m.content))
    .filter((s: string) => s.length > 0)
    .join("\n\n");

  return responses || "(no response)";
}

function cleanTerminalOutput(content: string): string {
  // Remove TUI artifacts and clean up the output
  return content
    .split("\n")
    .map(line => line.trimEnd())
    .filter(line => {
      // Filter out UI chrome
      if (line.includes("bypass permissions on")) return false;
      if (line.includes("shift+tab to cycle")) return false;
      if (line.match(/^[─│╭╮╰╯├┤┬┴┼\s]+$/)) return false;
      if (line.match(/^❯\s*$/)) return false;
      if (line.trim() === "") return false;
      return true;
    })
    .join("\n")
    .trim();
}

function cleanup(): void {
  if (agentProcess) {
    console.log("\nStopping agent...");
    agentProcess.kill();
    agentProcess = null;
  }
}

async function main(): Promise<void> {
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  try {
    await startAgent();
    await acceptPermissionsPrompt();
  } catch (err) {
    console.error("Failed to start agent:", err);
    cleanup();
    process.exit(1);
  }

  console.log("\nReady! Type your messages (Ctrl+C to exit).");
  console.log("Commands: /status, /messages, /quit\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on("close", () => {
    cleanup();
    process.exit(0);
  });

  const askQuestion = (): void => {
    rl.question("you> ", async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        askQuestion();
        return;
      }

      if (trimmed === "/status") {
        const status = await getStatus();
        console.log(`Agent status: ${status}\n`);
        askQuestion();
        return;
      }

      if (trimmed === "/messages") {
        const res = await fetch(`http://localhost:${PORT}/messages`);
        const data = await res.json();
        console.log(JSON.stringify(data.messages, null, 2));
        console.log();
        askQuestion();
        return;
      }

      if (trimmed === "/quit" || trimmed === "/exit") {
        rl.close();
        return;
      }

      try {
        await sendMessage(trimmed);
        const response = await pollForResponse();
        console.log(`\nclaude>\n${response}\n`);
      } catch (err) {
        console.error("Error:", err);
      }

      askQuestion();
    });
  };

  askQuestion();
}

main();
