// ABOUTME: Dashboard header component with branding.
// ABOUTME: Displays Amadeus title and subtitle.

export function Header() {
  return (
    <header className="mb-8 text-center">
      <h1 className="mb-2 text-4xl font-light tracking-widest text-foreground">
        Amadeus
      </h1>
      <p className="text-sm text-muted-foreground">
        Task Orchestration Dashboard
      </p>
    </header>
  );
}
