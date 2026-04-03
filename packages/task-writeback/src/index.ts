import { promises as fs } from "node:fs";

const checkboxPattern = /^(\s*-\s\[[ xX]\]\s)(.*)$/;

export async function updateCheckboxInFile(input: {
  filePath: string;
  lineNumber: number;
  checked: boolean;
  summary?: string;
}): Promise<void> {
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

  const marker = input.checked ? "- [x] " : "- [ ] ";
  lines[lineIndex] = `${match[1].replace(/-\s\[[ xX]\]\s/, marker)}${match[2]}`;

  if (input.summary?.trim()) {
    const summaryLine = `  <!-- forgeflow: ${input.summary.trim()} -->`;
    const nextLine = lines[lineIndex + 1];

    if (nextLine?.includes("forgeflow:")) {
      lines[lineIndex + 1] = summaryLine;
    } else {
      lines.splice(lineIndex + 1, 0, summaryLine);
    }
  }

  await fs.writeFile(input.filePath, lines.join("\n"), "utf8");
}
