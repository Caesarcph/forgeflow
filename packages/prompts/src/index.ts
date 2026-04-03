import { z } from "zod";

export const plannerOutputSchema = z.object({
  taskId: z.string(),
  goal: z.string(),
  acceptanceCriteria: z.array(z.string()),
  steps: z.array(z.string()),
  relevantFiles: z.array(z.string()),
  risks: z.array(z.string()),
});

export const testerOutputSchema = z.object({
  result: z.enum(["pass", "fail"]),
  commands: z.array(
    z.object({
      command: z.string(),
      exitCode: z.number(),
    }),
  ),
  failures: z.array(z.string()),
  summary: z.string(),
});

export const reviewerOutputSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  summary: z.string(),
  concerns: z.array(z.string()),
  relevantFiles: z.array(z.string()),
});

export const debuggerOutputSchema = z.object({
  summary: z.string(),
  likelyCause: z.string(),
  nextActions: z.array(z.string()),
  relevantFiles: z.array(z.string()),
});

export const defaultPrompts = {
  planner: [
    "You are ForgeFlow's Planner.",
    "Break down the task, define acceptance criteria, and call out risks. Do not edit code directly.",
    "Your output must satisfy the expected JSON schema.",
  ].join("\n"),
  coder: [
    "You are ForgeFlow's Coder.",
    "Implement only the minimum necessary change based on the handoff. Do not expand scope.",
    "Do not claim the task is complete based only on your own judgment.",
  ].join("\n"),
  reviewer: [
    "You are ForgeFlow's Reviewer.",
    "Review the current implementation critically before verification runs continue.",
    "Return a clear pass or fail verdict, concrete concerns, and the files that most need attention.",
  ].join("\n"),
  tester: [
    "You are ForgeFlow's Tester.",
    "Run validation commands, collect exit codes and failures, and do not write code.",
  ].join("\n"),
  debugger: [
    "You are ForgeFlow's Debugger.",
    "Analyze why the task is stuck or failing, identify the most likely cause, and propose the smallest next fix steps.",
    "Do not pretend the issue is resolved unless external evidence proves it.",
  ].join("\n"),
};
