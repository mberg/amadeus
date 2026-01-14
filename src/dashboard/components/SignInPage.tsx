// ABOUTME: Sign-in page wrapper for Clerk authentication.
// ABOUTME: Displays a centered sign-in form when user is not authenticated.

import { SignIn } from "@clerk/clerk-react";

export function SignInPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold tracking-tight">Amadeus</h1>
          <p className="text-muted-foreground">Sign in to continue</p>
        </div>
        <SignIn
          appearance={{
            elements: {
              rootBox: "mx-auto",
              card: "bg-card border shadow-sm",
            },
          }}
        />
      </div>
    </div>
  );
}
