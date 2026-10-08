#!/usr/bin/env python3
"""Allow only read, list, search, and edit. Deny every other tool."""
import json
import sys

ALLOW = {
    "read_file",
    "list_dir",
    "grep",
    "search_replace",
    "write",
    "read",
    "edit",
    "glob",
}

def main():
    raw = sys.stdin.read()
    try:
        event = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        decision = "deny"
        reason = "AI Shell could not read this tool request."
    else:
        name = str(
            event.get("tool_name")
            or event.get("toolName")
            or event.get("tool_name")
            or ""
        ).strip().lower()
        if name in ALLOW:
            decision = "defer"
            reason = ""
        else:
            decision = "deny"
            reason = "AI Shell only allows read, list, search, and edit."
    payload = {"decision": decision}
    if reason:
        payload["reason"] = reason
    sys.stdout.write(json.dumps(payload))

if __name__ == "__main__":
    main()
