// Small shared helpers for consistent chip styling across pages.

export function sentimentChip(s: string | null | undefined): string {
  switch (s) {
    case "supportive":
    case "leaning_supportive":
      return "chip-success";
    case "opposed":
    case "leaning_opposed":
      return "chip-danger";
    case "undecided":
      return "chip-warning";
    default:
      return "chip-neutral";
  }
}

export function priorityChip(p: number): string {
  if (p >= 50) return "chip-danger";
  if (p >= 25) return "chip-warning";
  if (p >= 10) return "chip-primary";
  return "chip-neutral";
}
