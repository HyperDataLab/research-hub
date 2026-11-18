import type { ReactNode } from "react";
import { ResearchHubShell } from "@/components/research-hub-shell";

export default function HubLayout({ children }: { children: ReactNode }) {
  return <ResearchHubShell>{children}</ResearchHubShell>;
}
