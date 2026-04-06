/**
 * Run uvicorn from backend/.venv (cross-platform).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backend = path.join(__dirname, "..", "backend");
const isWin = process.platform === "win32";
const py = path.join(backend, ".venv", isWin ? "Scripts/python.exe" : "bin/python");

const child = spawn(
  py,
  ["-m", "uvicorn", "main:app", "--reload", "--host", "127.0.0.1", "--port", "8000"],
  { cwd: backend, stdio: "inherit" }
);

child.on("exit", (code) => process.exit(code ?? 0));
