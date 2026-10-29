const rootUrl = "https://the-internet.herokuapp.com";

export const scenarios = {
  nested: {
    url: `${rootUrl}/nested_frames`,
    goal: "Open the nested frames example. Inspect the live page and report the exact words in the three top child frames and the bottom frame. Read the frames rather than guessing from the page name.",
  },
  challenging: {
    url: `${rootUrl}/challenging_dom`,
    goal: "Open the Challenging DOM example. Find the table row whose first cell is Iuvaret4, read its Diceret cell, then click the edit link in that same row. Report the cell value and the URL after the click. Explain which visible evidence you used to identify the row.",
  },
  dynamic: {
    url: `${rootUrl}/dynamic_loading/2`,
    goal: "Open Dynamic Loading example 2. Click Start, wait for the asynchronously rendered result, and report the exact text that appears. Do not report success before observing the result.",
  },
} as const;

export type ScenarioName = keyof typeof scenarios;
