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
        onNewProject={() => undefined}
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
    expect(html).toContain("New project");
    expect(html).not.toContain("folder path");
    expect(html).toContain("unify-mono");
    expect(html).toContain("session-tag");
    expect(html).toContain("sonnet");
    expect(html).toContain("New session");
    expect(html).toContain('<option value="claude" selected="">claude</option>');
    expect(html).toContain("Browse");
    expect(html).not.toContain("Light mode");
    const nameAt = html.indexOf("session-name");
    const tagAt = html.indexOf("session-tag");
    expect(nameAt).toBeGreaterThan(-1);
    expect(tagAt).toBeGreaterThan(nameAt);
    expect(html).not.toContain(">Remove<");
  });

  it("offers Remove in the project menu when the current project is empty and not last", () => {
    const state = freshState();
    state.projects = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
    state.activeProjectId = "a";
    const html = renderToStaticMarkup(
      <Sidebar
        state={state}
        onProject={() => undefined}
        onNewProject={() => undefined}
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
    expect(html).toContain("New project");
    expect(html).toContain(">Remove<");
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
        onToggleTheme={() => undefined}
        onToggleWidth={() => undefined}
        sidebarOpen
        terminalOpen={false}
        theme="dark"
        chatWidth="column"
      />,
    );
    const sidebarAt = html.indexOf('aria-label="Sidebar"');
    const titleAt = html.indexOf("unify-mono");
    const terminalAt = html.indexOf('aria-label="Terminal"');
    expect(sidebarAt).toBeGreaterThan(-1);
    expect(titleAt).toBeGreaterThan(sidebarAt);
    expect(terminalAt).toBeGreaterThan(titleAt);
    expect(html).toContain('aria-label="Light mode"');
    expect(html).toContain('aria-label="Full width"');
    expect(html).toContain('class="composer-dock"');
    expect(html.indexOf('class="composer"')).toBeGreaterThan(html.indexOf('class="composer-dock"'));
    expect(html).toContain('class="composer-field"');
    expect(html).toContain("</textarea></div><button");
    expect(html).toContain('rows="1"');
    expect(html).toContain("Message Leonardo…");
  });
});
