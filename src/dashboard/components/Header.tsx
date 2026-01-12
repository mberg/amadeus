// ABOUTME: Dashboard header component with branding.
// ABOUTME: Displays Amadeus title with gradient styling.

export function Header() {
  return (
    <header className="mb-8 text-center">
      <h1 className="mb-2 bg-gradient-to-r from-primary to-accent bg-clip-text text-4xl font-light tracking-widest text-transparent">
        Amadeus
      </h1>
      <p className="text-sm text-muted-foreground">
        Task Orchestration Dashboard
      </p>
    </header>
  );
}
