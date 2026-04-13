import { promises as fs } from "node:fs";

const checkboxPattern = /^(\s*-\s\[[ xX]\]\s)(.*)$/;

export type DryRunResult = {
  originalContent: string;
  modifiedContent: string;
  changes: string[];
};

export async function updateCheckboxInFile(input: {
  filePath: string;
  lineNumber: number;
  checked: boolean;
  summary?: string;
  dryRun?: boolean;
}): Promise<DryRunResult | void> {
  const content = await fs.readFile(input.filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const lineIndex = input.lineNumber - 1;

  if (!lines[lineIndex]) {
    throw new Error(`Line ${input.lineNumber} does not exist in ${input.filePath}`);
  }

  const match = lines[lineIndex].match(checkboxPattern);

  if (!match) {
    throw new Error(`Line ${input.lineNumber} is not a checkbox task`);
  }

  const changes: string[] = [];
  const originalContent = content;

  const marker = input.checked ? "- [x] " : "- [ ] ";
  lines[lineIndex] = `${match[1].replace(/-\s\[[ xX]\]\s/, marker)}${match[2]}`;
  changes.push(`Mark checkbox as ${input.checked ? "checked" : "unchecked"} on line ${input.lineNumber}`);

  if (input.summary?.trim()) {
    const summaryLine = ` <!-- forgeflow: ${input.summary.trim()} -->`;
    const nextLine = lines[lineIndex + 1];

    if (nextLine?.includes("forgeflow:")) {
      lines[lineIndex + 1] = summaryLine;
      changes.push(`Update forgeflow summary comment on line ${input.lineNumber + 1}`);
    } else {
      lines.splice(lineIndex + 1, 0, summaryLine);
      changes.push(`Insert forgeflow summary comment after line ${input.lineNumber}`);
    }
  }

  const modifiedContent = lines.join("\n");

  if (input.dryRun) {
    return {
      originalContent,
      modifiedContent,
      changes,
    };
  }

  await fs.writeFile(input.filePath, modifiedContent, "utf8");
}
