import { useEffect, useState } from "react";
import { api, type Health } from "./api";
import { ConfigErrorPanel } from "./ui/ConfigErrorPanel";

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.health().then(setHealth, (e: Error) => setError(e.message));
  }, []);

  return (
    <div className="app">
      <header className="header">
        <img src="/boostlingo-logo.png" alt="Boostlingo" width={152} height={28} />
        <span className="divider" aria-hidden />
        <h1>Interpreter Workbench</h1>
      </header>
      <main>
        {error && <p role="alert">Backend unreachable: {error}</p>}
        {health && !health.configOk && <ConfigErrorPanel missing={health.missing} />}
        {health?.configOk && <p data-testid="health-ok">Backend healthy. All provider keys present.</p>}
      </main>
    </div>
  );
}
