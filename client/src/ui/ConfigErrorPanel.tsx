/** config_error: startup panel listing missing variable names (never values). */
export function ConfigErrorPanel({ missing }: { missing: string[] }) {
  return (
    <section className="panel config-error" role="alert" aria-labelledby="config-error-title">
      <h2 id="config-error-title">Configuration missing</h2>
      <p className="secondary">Add these to .env in the project folder, then restart the app.</p>
      <div className="mono-box" data-testid="missing-vars">
        {missing.map((name) => (
          <div key={name}>{name}</div>
        ))}
      </div>
    </section>
  );
}
