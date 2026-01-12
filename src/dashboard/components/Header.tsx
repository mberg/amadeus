// ABOUTME: Dashboard header component with branding.
// ABOUTME: Displays Amadeus title and subtitle.

export function Header() {
  return (
    <header className="mb-6 flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Amadeus
        </h1>
        <p className="text-sm text-muted-foreground">
          Task Orchestration Dashboard
        </p>
      </div>
    </header>
  );
}
