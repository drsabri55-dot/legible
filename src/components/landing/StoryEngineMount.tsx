"use client";

import { useEffect } from "react";
import { StoryEngine } from "@/lib/story/engine";

// Starts the scroll story on the landing page and stops it on the way out.
export function StoryEngineMount({ rootId }: { rootId: string }) {
  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root) return;
    const engine = new StoryEngine(root);
    engine.start();
    return () => engine.stop();
  }, [rootId]);
  return null;
}
