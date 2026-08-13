export type DomainState = "available" | "registered" | "unknown";

export type DomainResult = {
  domain: string;
  label: string;
  tld: string;
  state: DomainState;
  statusCode?: number;
  score: number;
  reason?: string;
};

export type StreamEvent =
  | { type: "status"; stage: string; progress: number; message: string; heartbeat: string }
  | { type: "candidate"; result: DomainResult; checked: number; total: number; heartbeat: string }
  | { type: "complete"; results: DomainResult[]; checked: number; total: number; heartbeat: string }
  | { type: "error"; message: string; heartbeat: string };
