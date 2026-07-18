import type { CategoriesConfig } from "../../../config/schema/categories"

export const BUILTIN_MOA_CATEGORIES: CategoriesConfig = {
  "moa-architect": {
    model: "anthropic/claude-opus-4-7",
    fallback_models: ["openai/gpt-5.5", "google/gemini-3.1-pro"],
  },
  "moa-validator": {
    model: "openai/gpt-5.6-sol",
    fallback_models: ["anthropic/claude-opus-4-7", "google/gemini-3.1-pro"],
  },
  "moa-researcher": {
    model: "openai/gpt-5.6-terra",
    fallback_models: ["google/gemini-3.1-pro", "anthropic/claude-opus-4-7"],
  },
  "moa-challenger": {
    model: "google/gemini-3.1-pro",
    fallback_models: ["anthropic/claude-opus-4-7", "openai/gpt-5.5"],
  },
  "moa-skeptic": {
    model: "openai/gpt-5.6-luna",
    fallback_models: ["openai/gpt-5.4-mini", "anthropic/claude-sonnet-4-6"],
  },
  "moa-security-reviewer": {
    model: "anthropic/claude-opus-4-7",
    fallback_models: ["openai/gpt-5.6-terra", "openai/gpt-5.5"],
  },
  "moa-aggregator": {
    model: "openai/gpt-5.5",
    fallback_models: ["anthropic/claude-opus-4-7", "google/gemini-3.1-pro"],
  },
  "moa-aggregator-frontier": {
    model: "anthropic/claude-opus-4-7",
    fallback_models: ["openai/gpt-5.5", "google/gemini-3.1-pro"],
  },
  "moa-aggregator-fast": {
    model: "anthropic/claude-sonnet-4-6",
    fallback_models: ["openai/gpt-5.4-mini"],
  },
  "moa-budget-gpt-mini": {
    model: "openai/gpt-5.4-mini",
    fallback_models: ["anthropic/claude-haiku-4-5"],
  },
  "moa-budget-gemini-flash": {
    model: "google/gemini-3-flash",
    fallback_models: ["openai/gpt-5.4-mini"],
  },
  "moa-budget-kimi": {
    model: "opencode-go/kimi-k2.6",
    fallback_models: ["opencode/kimi-k2.5"],
  },
}
