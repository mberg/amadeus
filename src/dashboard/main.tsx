// ABOUTME: React application entry point.
// ABOUTME: Mounts the App component to the DOM with theme and auth support.

import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider } from "./components/ThemeProvider";
import { AuthProvider, Protected } from "./components/AuthProvider";
import { SignInPage } from "./components/SignInPage";
import "./index.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

const root = createRoot(container);
root.render(
  <ThemeProvider>
    <AuthProvider>
      <Protected fallback={<SignInPage />}>
        <App />
      </Protected>
    </AuthProvider>
  </ThemeProvider>
);
