import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PermissionCard } from "./PermissionCard";

describe("PermissionCard", () => {
  it("shows the tool name and both buttons", () => {
    const html = renderToStaticMarkup(
      <PermissionCard name="Bash" input={{ command: "ls" }} answered={null} onAnswer={() => undefined} />,
    );
    expect(html).toContain("Bash");
    expect(html).toContain("ls");
    expect(html).toContain("Allow");
    expect(html).toContain("Deny");
  });
});
