// Produces a short, plain-English tag describing a voter's past turnout.
export function voteTag(
  relevantVotes: number | null | undefined,
  totalVotes: number | null | undefined,
  raceLabel: string = "relevant",
): { text: string; chipClass: string } {
  const r = relevantVotes ?? 0;
  const t = totalVotes ?? 0;

  if (r === 0 && t === 0) return { text: "never voted", chipClass: "chip-neutral" };
  if (r === 0)             return { text: `voted ${t}x — none ${raceLabel}`, chipClass: "chip-neutral" };
  if (r >= 5)              return { text: `${r}x ${raceLabel} voter`, chipClass: "chip-success" };
  if (r >= 3)              return { text: `${r}x ${raceLabel} voter`, chipClass: "chip-primary" };
  return                          { text: `${r}x ${raceLabel} voter`, chipClass: "chip-warm" };
}

export function raceLabelFor(raceType: string | null | undefined): string {
  switch (raceType) {
    case "primary_dem": return "Dem primary";
    case "primary_rep": return "Rep primary";
    case "primary_any": return "primary";
    case "general":     return "general";
    case "municipal":   return "municipal";
    case "special":     return "special";
    default:            return "election";
  }
}
