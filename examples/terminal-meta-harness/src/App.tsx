import { useEffect, useMemo, useState } from "react";

import { Box, Static, Text, useApp, useInput } from "ink";

import type { HarnessEvent, HarnessSession } from "./harness.js";

export function App(props: { readonly provider: string; readonly session: HarnessSession }) {
  const { exit } = useApp();
  const [events, setEvents] = useState<Array<HarnessEvent>>(() => [...props.session.history()]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const permission = useMemo(() => pendingPermission(events), [events]);

  useEffect(
    () => props.session.subscribe((event) => setEvents((current) => [...current, event])),
    [props.session],
  );

  useInput((character, key) => {
    if (permission !== null) {
      const option = permission.payload.options[Number(character) - 1];
      if (option !== undefined) props.session.respondPermission(option.optionId);
      return;
    }
    if (busy) return;
    if (key.return) {
      const prompt = input.trim();
      setInput("");
      if (prompt === ":quit") {
        exit();
        return;
      }
      if (prompt === "") return;
      setBusy(true);
      setError(null);
      void props.session
        .prompt(prompt)
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => setBusy(false));
      return;
    }
    if (key.backspace || key.delete) {
      setInput((current) => current.slice(0, -1));
      return;
    }
    if (key.ctrl && character === "u") {
      setInput("");
      return;
    }
    if (!key.ctrl && !key.meta && character !== "") {
      setInput((current) => current + character);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={1}>
        <Text bold color="cyan">
          terminal-meta-harness
        </Text>
        <Text dimColor>
          {props.provider} · {props.session.id}
        </Text>
      </Box>

      <Static items={events}>{(event, index) => <EventLine key={index} event={event} />}</Static>

      {permission === null ? null : (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">Permission: {permission.payload.title}</Text>
          {permission.payload.options.map((option, index) => (
            <Text key={option.optionId}>
              {index + 1}. {option.name}
            </Text>
          ))}
        </Box>
      )}

      {error === null ? null : <Text color="red">Error: {error}</Text>}
      <Box marginTop={1}>
        <Text color="green">{permission === null ? "you>" : "choose>"} </Text>
        <Text>{busy && permission === null ? "working…" : input}</Text>
        {busy || permission !== null ? null : <Text inverse> </Text>}
      </Box>
      <Text dimColor>Enter sends · :quit exits · Ctrl+U clears</Text>
    </Box>
  );
}

function pendingPermission(
  events: ReadonlyArray<HarnessEvent>,
): Extract<HarnessEvent, { readonly kind: "permission_requested" }> | null {
  let pending: Extract<HarnessEvent, { readonly kind: "permission_requested" }> | null = null;
  for (const event of events) {
    if (event.kind === "permission_requested") pending = event;
    if (event.kind === "permission_resolved") pending = null;
  }
  return pending;
}

function EventLine(props: { readonly event: HarnessEvent }) {
  const event = props.event;
  if (event.kind === "user_message") return <Text color="green">you: {event.payload.text}</Text>;
  if (event.kind === "agent_message") return <Text>agent: {event.payload.text}</Text>;
  if (event.kind === "agent_thought") return <Text dimColor>thought: {event.payload.text}</Text>;
  if (event.kind === "tool_call") {
    return (
      <Text color="magenta">
        tool: {event.payload.title} ({event.payload.status})
      </Text>
    );
  }
  if (event.kind === "turn_finished") {
    return <Text dimColor>turn: {event.payload.stopReason}</Text>;
  }
  return null;
}
