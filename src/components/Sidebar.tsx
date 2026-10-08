import { useState, type CSSProperties } from "react";
import type { AgentId } from "../state/agents";
import type { AppState } from "../state/types";
import { canDeleteProject } from "../state/projects";
import { TURTLES } from "../theme/turtles";

type Props = {
  style?: CSSProperties;
  state: AppState;
  onProject: (id: string) => void;
  onCreateProject: (name: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
  onSelect: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onClose: (id: string) => void;
  agents: string[];
  onAgent: (agent: AgentId) => void;
  onNewSession: () => void;
  onBrowse: () => void;
  onTypedFolder: (folder: string) => void;
};

export function Sidebar(props: Props) {
  const project = props.state.projects.find((item) => item.id === props.state.activeProjectId) ?? props.state.projects[0];
  const sessions = props.state.sessions.filter((session) => session.projectId === project.id);
  const [creating, setCreating] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [editingProject, setEditingProject] = useState(false);
  const [folder, setFolder] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const sessionCount = sessions.length;
  return (
    <aside className="sidebar" style={props.style}>
      <div className="project-switcher">
        {editingProject ? (
          <input
            autoFocus
            defaultValue={project.name}
            onBlur={(event) => { props.onRenameProject(project.id, event.target.value.trim() || project.name); setEditingProject(false); }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setEditingProject(false);
            }}
          />
        ) : (
          <button type="button" className="project-name" title="Double-click to rename" onDoubleClick={() => setEditingProject(true)} onClick={(event) => {
            const menu = event.currentTarget.nextElementSibling;
            menu?.classList.toggle("open");
          }}>
            {project.name} ▾
          </button>
        )}
        <div className="project-menu">
          {props.state.projects.map((item) => (
            <button type="button" key={item.id} className={item.id === project.id ? "active" : undefined} onClick={() => props.onProject(item.id)}>{item.name}</button>
          ))}
        </div>
        {creating ? (
          <input
            autoFocus
            placeholder="Project name"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") { setCreating(false); setProjectName(""); }
              if (event.key === "Enter" && projectName.trim()) {
                props.onCreateProject(projectName.trim());
                setProjectName("");
                setCreating(false);
              }
            }}
          />
        ) : (
          <button type="button" onClick={() => setCreating(true)}>New project…</button>
        )}
        {canDeleteProject(props.state.projects, project.id, sessionCount) ? (
          <button type="button" onClick={() => props.onDeleteProject(project.id)}>Delete</button>
        ) : null}
      </div>
      <div className="session-scroll">
        {sessions.length === 0 ? <p className="session-empty">No sessions yet.</p> : (
          <ul className="session-list">
            {sessions.map((session) => {
              const turtle = TURTLES.find((item) => item.name === session.turtle) ?? TURTLES[0];
              const active = session.id === props.state.activeSessionId;
              return (
                <li key={session.id} className={active ? "active" : ""}>
                  <button type="button" className="session-row" title="Double-click to rename" onClick={() => props.onSelect(session.id)} onDoubleClick={() => setEditingId(session.id)}>
                    <span className="mask" style={{ background: turtle.color }} />
                    {editingId === session.id ? (
                      <input
                        autoFocus
                        defaultValue={session.label}
                        onClick={(event) => event.stopPropagation()}
                        onBlur={(event) => { props.onRename(session.id, event.target.value.trim() || session.label); setEditingId(null); }}
                        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                      />
                    ) : (
                      <span className="session-label">
                        <span className="session-name">{session.label}</span>
                        <small>{session.agent} · {session.model}</small>
                      </span>
                    )}
                    {session.unread ? <i className="unread" style={{ background: turtle.color }} /> : null}
                  </button>
                  <button type="button" className="close" onClick={() => props.onClose(session.id)} aria-label={`Close ${session.label}`}>×</button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="session-actions">
        <label>
          Agent
          <select
            aria-label="Agent"
            value={props.agents.includes(props.state.selectedAgent) ? props.state.selectedAgent : ""}
            onChange={(event) => props.onAgent(event.target.value as AgentId)}
          >
            {props.agents.map((agent) => (
              <option key={agent} value={agent}>{agent}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={props.onNewSession}>New session</button>
        <button type="button" onClick={props.onBrowse}>Browse…</button>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (folder.trim()) {
              props.onTypedFolder(folder.trim());
              setFolder("");
            }
          }}
        >
          <input value={folder} placeholder="Or type a folder path" onChange={(event) => setFolder(event.target.value)} />
        </form>
      </div>
    </aside>
  );
}
