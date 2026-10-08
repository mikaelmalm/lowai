import { permissionView } from "../chat/permission";

export function PermissionCard({
  name,
  input,
  answered,
  onAnswer,
}: {
  name: string;
  input: unknown;
  answered: "allow" | "deny" | null;
  onAnswer: (allow: boolean) => void;
}) {
  const view = permissionView(name, input);
  return (
    <div className="permission-card">
      <strong>{view.name}</strong>
      {view.detail ? <code>{view.detail}</code> : null}
      <div className="actions">
        <button type="button" className="allow" disabled={answered != null} onClick={() => onAnswer(true)}>Allow</button>
        <button type="button" className="deny" disabled={answered != null} onClick={() => onAnswer(false)}>Deny</button>
      </div>
      {answered ? <span>{answered === "allow" ? "Allowed" : "Denied"}</span> : null}
    </div>
  );
}
