// Runs the dotnet CLI on Windows and macOS. Prefers a repo-local SDK in .dotnet/
// (installed with Microsoft's dotnet-install script when no global SDK exists),
// then $DOTNET_HOST_PATH, then `dotnet` on PATH.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exe = process.platform === "win32" ? "dotnet.exe" : "dotnet";
const local = join(root, ".dotnet", exe);

const env = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" };
let cmd = "dotnet";
if (existsSync(local)) {
  cmd = local;
  env.DOTNET_ROOT = join(root, ".dotnet");
} else if (process.env.DOTNET_HOST_PATH && existsSync(process.env.DOTNET_HOST_PATH)) {
  cmd = process.env.DOTNET_HOST_PATH;
}

const child = spawn(cmd, process.argv.slice(2), { stdio: "inherit", env, cwd: root });
const forward = (sig) => child.kill(sig);
process.on("SIGINT", forward);
process.on("SIGTERM", forward);
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
child.on("error", (err) => {
  console.error(`Could not start dotnet (${err.message}). Install the .NET 10 SDK: https://dotnet.microsoft.com/download`);
  process.exit(1);
});
