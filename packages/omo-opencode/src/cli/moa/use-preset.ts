import { isPlainRecord } from "@oh-my-opencode/utils"
import {
  updateJsoncFile,
  type UpdateJsoncFileOptions,
  type UpdateJsoncFileResult,
} from "@oh-my-opencode/omo-config-core"
import {
  evaluateMoAConfig,
  type MoAConfigEvaluation,
  type MoAEvaluationDependencies,
  type RawMoAConfig,
} from "../doctor/checks/moa-evaluator"

type JsoncWriter = (options: UpdateJsoncFileOptions) => UpdateJsoncFileResult

export type SetActiveMoaPresetInput = {
  readonly presetName: string
  readonly enable: boolean
  readonly candidate: RawMoAConfig
  readonly configPath: string
  readonly evaluationDependencies: MoAEvaluationDependencies
  readonly evaluate?: typeof evaluateMoAConfig
  readonly write?: JsoncWriter
}

export type SetActiveMoaPresetResult =
  | { readonly ok: true; readonly evaluation: MoAConfigEvaluation; readonly writeResult: UpdateJsoncFileResult }
  | { readonly ok: false; readonly evaluation: MoAConfigEvaluation }

function candidateMoa(input: SetActiveMoaPresetInput): unknown {
  const raw = input.candidate.moa
  if (raw !== undefined && !isPlainRecord(raw)) return raw
  return {
    ...(raw ?? {}),
    default_preset: input.presetName,
    ...(input.enable ? { enabled: true } : {}),
  }
}

export function setActiveMoaPreset(input: SetActiveMoaPresetInput): SetActiveMoaPresetResult {
  const evaluate = input.evaluate ?? evaluateMoAConfig
  const nextCandidate = { ...input.candidate, moa: candidateMoa(input) }
  const evaluation = evaluate(nextCandidate, {
    ...input.evaluationDependencies,
    presetName: input.presetName,
  })
  if (!evaluation.valid) return { ok: false, evaluation }

  const edits: UpdateJsoncFileOptions["edits"] = [
    { path: ["moa", "default_preset"], value: input.presetName },
    ...(input.enable ? [{ path: ["moa", "enabled"], value: true }] : []),
  ]
  const write = input.write ?? updateJsoncFile
  const writeResult = write({ path: input.configPath, edits })
  return { ok: true, evaluation, writeResult }
}
