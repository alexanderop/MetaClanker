import type { ThreadStatus } from "@metaclanker/contracts/wire";

export interface ThreadRuntimeState {
  readonly status: ThreadStatus;
  readonly activeTurnId: string | null;
  readonly cancelRequested: boolean;
  readonly disconnected: boolean;
}

export const initialThreadRuntimeState: ThreadRuntimeState = {
  status: "idle",
  activeTurnId: null,
  cancelRequested: false,
  disconnected: false,
};

export type ThreadAction =
  | { readonly type: "start"; readonly turnId: string }
  | { readonly type: "request-cancel" }
  | {
      readonly type: "settle";
      readonly outcome: "completed" | "cancelled" | "interrupted" | "failed";
    }
  | { readonly type: "disconnect" };

export const transitionThread = (
  state: ThreadRuntimeState,
  action: ThreadAction,
): ThreadRuntimeState => {
  if (action.type === "start") {
    if (state.activeTurnId !== null) {
      return state;
    }

    return {
      status: "running",
      activeTurnId: action.turnId,
      cancelRequested: false,
      disconnected: false,
    };
  }

  if (action.type === "request-cancel") {
    if (state.activeTurnId === null) {
      return state;
    }

    return { ...state, status: "cancelling", cancelRequested: true };
  }

  if (action.type === "disconnect") {
    return {
      status: state.activeTurnId === null ? "disconnected" : "recovery-required",
      activeTurnId: null,
      cancelRequested: false,
      disconnected: true,
    };
  }

  const settledStatus: ThreadStatus = action.outcome;
  return {
    status: settledStatus,
    activeTurnId: null,
    cancelRequested: false,
    disconnected: state.disconnected,
  };
};
