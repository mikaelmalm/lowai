/** macOS keeps rounded window corners in fullscreen. Windows and Linux go square. */
export function fullscreenKeepsRoundedCorners(platform: string): boolean {
  return /mac/i.test(platform);
}
