// ABOUTME: Dashboard header component with branding and theme toggle.
// ABOUTME: Displays Amadeus title and dark/light mode switch.

import { Sun, Moon } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { Button } from "./ui/button";

export function Header() {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="mb-6 flex items-center justify-between">
      <h1 className="text-lg font-medium tracking-tight text-foreground">
        Amadeus
      </h1>
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleTheme}
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
      >
        {theme === "dark" ? (
          <Sun className="h-4 w-4" />
        ) : (
          <Moon className="h-4 w-4" />
        )}
        <span className="sr-only">Toggle theme</span>
      </Button>
    </header>
  );
}
