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

function channel(hex: string, start: number): number {
  const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const normalized = hex.replace("#", "");
  return 0.2126 * channel(normalized, 0) + 0.7152 * channel(normalized, 2) + 0.0722 * channel(normalized, 4);
}

function mix(hex: string, toward: string, amount: number): string {
  const blend = (start: number) => {
    const from = Number.parseInt(hex.slice(start, start + 2), 16);
    const to = Number.parseInt(toward.slice(start, start + 2), 16);
    return Math.round(from + (to - from) * amount).toString(16).padStart(2, "0");
  };
  return `#${blend(1)}${blend(3)}${blend(5)}`;
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

const INK = "#ffffff";
const INK_DARK = "#171b20";

export function readableOn(color: string): { background: string; color: string } {
  let background = color.startsWith("#") ? color : `#${color}`;
  let ink = contrast(INK, background) >= contrast(INK_DARK, background) ? INK : INK_DARK;
  for (let step = 0; step < 6 && contrast(ink, background) < 4.5; step += 1) {
    background = mix(background, INK_DARK, 0.16);
    ink = contrast(INK, background) >= contrast(INK_DARK, background) ? INK : INK_DARK;
  }
  return { background, color: ink };
}
