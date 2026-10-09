import type { ReactNode } from "react";
import { ConsoleProvider } from "@/components/console";

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return <ConsoleProvider>{children}</ConsoleProvider>;
}
