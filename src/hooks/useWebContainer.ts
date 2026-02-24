import { useEffect, useRef, useState } from "react";
import { WebContainer } from "@webcontainer/api";

export function useWebContainer() {
  const [webcontainer, setWebcontainer] = useState<WebContainer>();
  const bootedRef = useRef(false);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    (async () => {
      const instance = await WebContainer.boot();
      setWebcontainer(instance);
    })();
  }, []);

  return webcontainer;
}
