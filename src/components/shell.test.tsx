import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatView } from "./ChatView";
import { Sidebar } from "./Sidebar";
import { freshState } from "../state/session-rules";
import type { Session } from "../state/types";

const session: Session = {
  id: "s1",
  agentSessionId: null,
  projectId: "project-personal",
  label: "unify-mono",
  folder: "/tmp/unify-mono",
  agent: "claude",
  model: "sonnet",
  turtle: "Leonardo",
  messages: [],
  unread: false,
  status: "asleep",
  terminalWidth: 480,
};

describe("sidebar", () => {
  it("lists sessions in one row and drops the extra controls", () => {
    const state = freshState();
    state.sessions = [session];
    state.activeSessionId = session.id;
    const html = renderToStaticMarkup(
      <Sidebar
        state={state}
        onProject={() => undefined}
        onRenameProject={() => undefined}
        onDeleteProject={() => undefined}
        onSelect={() => undefined}
        onRename={() => undefined}
        onClose={() => undefined}
        agents={["claude"]}
        onAgent={() => undefined}
        onNewSession={() => undefined}
        onBrowse={() => undefined}
      />,
    );
    expect(html).not.toContain("New project");
    expect(html).not.toContain("folder path");
    expect(html).toContain("unify-mono");
    expect(html).toContain("session-tag");
    expect(html).toContain("sonnet");
    expect(html).toContain("New session");
    expect(html).toContain("Browse");
    const nameAt = html.indexOf("session-name");
    const tagAt = html.indexOf("session-tag");
    expect(nameAt).toBeGreaterThan(-1);
    expect(tagAt).toBeGreaterThan(nameAt);
  });
});

describe("chat header and composer", () => {
  it("puts the sidebar control first, the title in the middle, and the terminal last", () => {
    const html = renderToStaticMarkup(
      <ChatView
        session={session}
        onSend={async () => ({})}
        onModel={() => undefined}
        onLink={() => undefined}
        onPermission={() => undefined}
        onTerminal={() => undefined}
        onSidebar={() => undefined}
        sidebarOpen
        terminalOpen={false}
      />,
    );
    const sidebarAt = html.indexOf('aria-label="Sidebar"');
    const titleAt = html.indexOf("unify-mono");
    const terminalAt = html.indexOf('aria-label="Terminal"');
    expect(sidebarAt).toBeGreaterThan(-1);
    expect(titleAt).toBeGreaterThan(sidebarAt);
    expect(terminalAt).toBeGreaterThan(titleAt);
    expect(html).toContain('class="composer-dock"');
    expect(html.indexOf('class="composer"')).toBeGreaterThan(html.indexOf('class="composer-dock"'));
    expect(html).toContain('class="composer-field"');
    expect(html).toContain("</textarea></div><button");
    expect(html).toContain('rows="1"');
    expect(html).toContain("Message Leonardo…");
  });
});
