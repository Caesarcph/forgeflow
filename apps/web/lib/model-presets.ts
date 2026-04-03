export interface ModelPreset {
  value: string;
  label: string;
}

export interface ProviderPreset {
  value: string;
  label: string;
  models: ModelPreset[];
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    value: "mock",
    label: "Mock",
    models: [{ value: "forgeflow-intake-mock", label: "forgeflow-intake-mock" }],
  },
  {
    value: "opencode",
    label: "OpenCode",
    models: [
      { value: "mimo-v2-pro-free", label: "MiMo V2 Pro Free" },
      { value: "mimo-v2-omni-free", label: "MiMo V2 Omni Free" },
      { value: "minimax-m2.5-free", label: "MiniMax M2.5 Free" },
      { value: "nemotron-3-super-free", label: "Nemotron 3 Super Free" },
      { value: "qwen3.6-plus-free", label: "Qwen 3.6 Plus Free" },
      { value: "big-pickle", label: "Big Pickle" },
      { value: "gpt-5-nano", label: "GPT 5 Nano" },
    ],
  },
  {
    value: "nvidia",
    label: "NVIDIA",
    models: [{ value: "z-ai/glm5", label: "GLM 5" }],
  },
  {
    value: "openai",
    label: "OpenAI",
    models: [
      { value: "gpt-5.4", label: "GPT 5.4" },
      { value: "gpt-5.3-codex", label: "GPT 5.3 Codex" },
      { value: "gpt-5-codex", label: "GPT 5 Codex" },
    ],
  },
];

export function getProviderPreset(provider: string) {
  return PROVIDER_PRESETS.find((preset) => preset.value === provider);
}

export function getProviderModels(provider: string) {
  return getProviderPreset(provider)?.models ?? [];
}

export function getDefaultModelForProvider(provider: string) {
  return getProviderModels(provider)[0]?.value ?? "";
}
