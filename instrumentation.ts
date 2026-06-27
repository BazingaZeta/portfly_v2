// Runs once when the Next.js server process boots (Node runtime only).
// Starts the Autopilot autonomous scheduler so the bot acts on its own
// while the server is open.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAutopilotScheduler } = await import("./lib/autopilotScheduler");
    startAutopilotScheduler();
  }
}
