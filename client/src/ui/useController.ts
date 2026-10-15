import { createContext, useContext, useSyncExternalStore } from "react";
import type { Snapshot, WorkbenchController } from "../session/controller";

export const ControllerContext = createContext<WorkbenchController | null>(null);

export function useController(): WorkbenchController {
  const c = useContext(ControllerContext);
  if (!c) throw new Error("ControllerContext missing");
  return c;
}

export function useSnapshot(): Snapshot {
  const c = useController();
  return useSyncExternalStore(c.subscribe, c.getSnapshot);
}
