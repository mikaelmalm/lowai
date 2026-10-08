export type Turtle = { name: string; color: string };

export const TURTLES: Turtle[] = [
  { name: "Leonardo", color: "#2f6fdb" },
  { name: "Raphael", color: "#e23b3b" },
  { name: "Donatello", color: "#8a4fd8" },
  { name: "Michelangelo", color: "#f28c28" },
  { name: "Splinter", color: "#8d6e63" },
  { name: "April", color: "#ef6ea8" },
  { name: "Casey", color: "#4caf7a" },
];

export function assignTurtle(used: string[]): Turtle {
  return TURTLES.find((turtle) => !used.includes(turtle.name)) ?? TURTLES[used.length % TURTLES.length];
}
