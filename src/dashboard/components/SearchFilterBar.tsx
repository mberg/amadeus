// ABOUTME: Search and filter controls for the task dashboard.
// ABOUTME: Provides text search and multi-select filters for state and skills.

import type React from "react";
import { Search, ChevronDown, X, Check } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { cn } from "../lib/utils";
import { getStateVariant } from "../lib/utils";
import type { LinearState } from "../types";

const LINEAR_STATES: LinearState[] = [
  "Planning",
  "Building",
  "Feedback Needed",
  "Review",
  "Done",
];

interface SearchFilterBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedStates: string[];
  onStatesChange: (states: string[]) => void;
  selectedSkills: string[];
  onSkillsChange: (skills: string[]) => void;
  availableSkills: string[];
}

export function SearchFilterBar({
  searchQuery,
  onSearchChange,
  selectedStates,
  onStatesChange,
  selectedSkills,
  onSkillsChange,
  availableSkills,
}: SearchFilterBarProps) {
  const toggleState = (state: string) => {
    if (selectedStates.includes(state)) {
      onStatesChange(selectedStates.filter((s) => s !== state));
    } else {
      onStatesChange([...selectedStates, state]);
    }
  };

  const toggleSkill = (skill: string) => {
    if (selectedSkills.includes(skill)) {
      onSkillsChange(selectedSkills.filter((s) => s !== skill));
    } else {
      onSkillsChange([...selectedSkills, skill]);
    }
  };

  const clearFilters = () => {
    onSearchChange("");
    onStatesChange([]);
    onSkillsChange([]);
  };

  const hasFilters =
    searchQuery.trim() !== "" ||
    selectedStates.length > 0 ||
    selectedSkills.length > 0;

  return (
    <div className="flex items-center gap-3 mb-4">
      {/* Search Input */}
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search tasks..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className={cn(
            "w-full h-9 pl-9 pr-3 rounded-md border border-border bg-background",
            "text-sm text-foreground placeholder:text-muted-foreground",
            "focus:outline-none focus:ring-1 focus:ring-ring",
            "transition-colors"
          )}
        />
      </div>

      {/* State Filter */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-1.5">
            State
            {selectedStates.length > 0 && (
              <Badge variant="default" className="ml-1 h-5 min-w-5 px-1.5">
                {selectedStates.length}
              </Badge>
            )}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {LINEAR_STATES.map((state) => {
            const isSelected = selectedStates.includes(state);
            return (
              <DropdownMenuItem
                key={state}
                onClick={(e: React.MouseEvent) => {
                  e.preventDefault();
                  toggleState(state);
                }}
                className="cursor-pointer"
              >
                <div
                  className={cn(
                    "mr-2 flex h-4 w-4 items-center justify-center rounded border border-border",
                    isSelected && "bg-primary border-primary"
                  )}
                >
                  {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                </div>
                <Badge variant={getStateVariant(state)} className="text-xs">
                  {state}
                </Badge>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Skills Filter */}
      {availableSkills.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5">
              Skills
              {selectedSkills.length > 0 && (
                <Badge variant="default" className="ml-1 h-5 min-w-5 px-1.5">
                  {selectedSkills.length}
                </Badge>
              )}
              <ChevronDown className="h-4 w-4 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {availableSkills.map((skill) => {
              const isSelected = selectedSkills.includes(skill);
              return (
                <DropdownMenuItem
                  key={skill}
                  onClick={(e: React.MouseEvent) => {
                    e.preventDefault();
                    toggleSkill(skill);
                  }}
                  className="cursor-pointer"
                >
                  <div
                    className={cn(
                      "mr-2 flex h-4 w-4 items-center justify-center rounded border border-border",
                      isSelected && "bg-primary border-primary"
                    )}
                  >
                    {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                  </div>
                  <span className="text-sm">{skill}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Clear Filters */}
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearFilters}
          className="h-9 px-2 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}
