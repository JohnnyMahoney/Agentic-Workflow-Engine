import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { Journal, type Event } from "../discovery/recorder.js";
import { runDiscovery } from "../discovery/run.js";
import { scenarios, type ScenarioName } from "../discovery/test-targets.js";

function assess(name: ScenarioName, journal: Journal, finalText: string, completed: boolean): Event {
  const allObserved = journal.observations.map((item) => item.text).join("\n");
  const clicked = journal.actions.includes("left_click");
  if (name === "nested") {
    const words = ["LEFT", "MIDDLE", "RIGHT", "BOTTOM"];
    const observedWords = words.filter((word) => new RegExp(`\\b${word}\\b`, "i").test(allObserved));
    return { completed, observedWords, passed: completed && observedWords.length === words.length && words.every((word) => new RegExp(`\\b${word}\\b`, "i").test(finalText)) };
  }
  if (name === "challenging") {
    const rowObserved = allObserved.includes("Iuvaret4") && allObserved.includes("Phaedrum4");
    const clickedRowProven = journal.targetInspections.some(({ action, target }) => journal.clickActions.includes(action) && target.rowFirstCell === "Iuvaret4" && target.tag === "a" && target.label === "edit");
    return { completed, clicked, rowObserved, clickedRowProven, reportedValue: finalText.includes("Phaedrum4"), passed: completed && clicked && clickedRowProven && rowObserved && finalText.includes("Phaedrum4"), targetStillNeedsReplayValidation: true };
  }
  const firstClick = journal.clickActions[0];
  const resultObservedAfterClick = firstClick !== undefined && journal.observations.some((item) => item.action > firstClick && item.text.includes("Hello World!"));
  return { completed, clicked, resultObservedAfterClick, reportedValue: finalText.includes("Hello World!"), passed: completed && clicked && resultObservedAfterClick && finalText.includes("Hello World!") };
}

function options(): { selected: ScenarioName[]; model: string; headless: boolean } {
  const args = process.argv.slice(2);
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    return index < 0 ? undefined : args[index + 1];
  };
  const scenario = value("--scenario") ?? "all";
  if (scenario !== "all" && !(scenario in scenarios)) throw new Error(`Unknown scenario: ${scenario}`);
  return {
    selected: scenario === "all" ? Object.keys(scenarios) as ScenarioName[] : [scenario as ScenarioName],
    model: value("--model") ?? "claude-sonnet-5-5",
    headless: !args.includes("--headed"),
  };
}

async function main(): Promise<void> {
  const { selected, model, headless } = options();
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required for a genuine LLM-driven run.");
  if (!existsSync(chromium.executablePath())) throw new Error("Playwright Chromium is missing. Run: npx.cmd playwright install chromium");
  const directory = join("evidence", "browser-use-spike", new Date().toISOString().replace(/[:.]/g, "-"));
  const results: Event[] = [];
  for (const name of selected) {
    results.push(await runDiscovery({ name, ...scenarios[name], model, headless, directory: join(directory, name), assess: (journal, finalText, completed) => assess(name, journal, finalText, completed) }));
  }
  console.log(JSON.stringify({ directory, results }, null, 2));
  if (results.some((result) => !(result.assessment as { passed: boolean }).passed)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
