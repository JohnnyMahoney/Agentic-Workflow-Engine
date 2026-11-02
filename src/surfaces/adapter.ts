import type { Target } from "../capability/contract.js";

// Implementations own browser/OS handles; the workflow never sees them.
export interface SurfaceAdapter {
  navigate(url: string): Promise<void>;
  click(target: Target): Promise<void>;
  fill(target: Target, value: string): Promise<void>;
  selectOption(target: Target, by: "label" | "value", value: string): Promise<void>;
  extract(target: Target): Promise<string>;
  visible(target: Target): Promise<boolean>;
  url(): string;
  captureFailure(path: string): Promise<void>;
  close(): Promise<void>;
}
