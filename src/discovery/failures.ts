import { ToolError } from "@anthropic-ai/sdk/helpers/beta/toolsets";

export const FORM_INPUT_REJECTED_MESSAGE = "Only string form input on an observed reference is supported";

// Only throw this from a guard that precedes all potentially mutating browser calls.
export class BeforeDispatchError extends ToolError {
  readonly phase = "beforeDispatch";
  readonly code = "FORM_INPUT_REJECTED";
  constructor() { super(FORM_INPUT_REJECTED_MESSAGE); }
}
