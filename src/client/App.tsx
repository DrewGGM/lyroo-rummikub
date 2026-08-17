import { useCallback, useEffect, useState } from "react";

import { isRoomCode, normalizeRoomCode } from "../protocol";
import { Home } from "./screens/Home";
import { Room } from "./screens/Room";

/**
 * Dos sitios: la portada y una mesa. La mesa vive en `/g/CODIGO` para que el
 * enlace que compartes lleve directo a ella y se pueda guardar en favoritos.
 */
export function App() {
  const [code, setCode] = useState(readCode);

  useEffect(() => {
    const onPop = () => setCode(readCode());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const enter = useCallback((next: string) => {
    window.history.pushState(null, "", `/g/${next}`);
    setCode(next);
  }, []);

  const leave = useCallback(() => {
    window.history.pushState(null, "", "/");
    setCode(null);
  }, []);

  if (code) return <Room code={code} onLeave={leave} />;
  return <Home onEnter={enter} />;
}

function readCode(): string | null {
  const match = /^\/g\/([^/]+)\/?$/.exec(window.location.pathname);
  if (!match) return null;
  const code = normalizeRoomCode(decodeURIComponent(match[1]!));
  return isRoomCode(code) ? code : null;
}
