import { ModelID, ProviderID } from "./schema"
import type { Info, Model } from "./provider"

export const id = ProviderID.make("redou-codex")
export const defaultModelID = ModelID.make("default")

const defaultModel: Model = {
  id: defaultModelID,
  providerID: id,
  name: "Redou Codex Default",
  family: "redou-codex",
  api: {
    id: "default",
    url: "redou-codex://local-runtime",
    npm: "redou-codex-runtime",
  },
  status: "active",
  headers: {},
  options: {},
  cost: {
    input: 0,
    output: 0,
    cache: {
      read: 0,
      write: 0,
    },
  },
  limit: {
    context: 131072,
    output: 16384,
  },
  capabilities: {
    temperature: true,
    reasoning: true,
    attachment: true,
    toolcall: true,
    input: {
      text: true,
      audio: false,
      image: true,
      video: false,
      pdf: true,
    },
    output: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    interleaved: false,
  },
  release_date: "",
  variants: {},
}

export const info: Info = {
  id,
  name: "Redou Codex",
  source: "custom",
  env: ["REDOU_CODEX_API_KEY", "REDOU_CODEX_BASE_URL", "REDOU_CODEX_MODEL", "REDOU_CODEX_RUNTIME_ROOT"],
  options: {},
  models: {
    [defaultModelID]: defaultModel,
  },
}

export const RedouCodexProvider = { id, defaultModelID, info } as const
