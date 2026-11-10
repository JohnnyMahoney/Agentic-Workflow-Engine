import type { Target, ExtractProperty } from "../capability/contract.js";

// Implementations own browser/OS handles; the workflow never sees them.
export interface SurfaceAdapter {
  authorize?(action: "click" | "fill" | "selectOption", target: Target): Promise<void>;
  setOperationTimeout?(timeoutMs: number): void;
  unexpectedDialog?(): string | undefined;
  navigate(url: string): Promise<void>;
  click(target: Target): Promise<void>;
  fill(target: Target, value: string): Promise<void>;
  selectOption(target: Target, by: "label" | "value", value: string): Promise<void>;
  extract(target: Target, property?: ExtractProperty): Promise<string>;
  visible(target: Target): Promise<boolean>;
  url(): string;
  captureFailure(path: string): Promise<void>;
  observeHuman?(record: (event: Record<string, unknown>) => void): Promise<() => Promise<void>>;
  isClosed?(): boolean;
  setHumanInputEnabled?(enabled: boolean): Promise<void>;
  close(): Promise<void>;
}
