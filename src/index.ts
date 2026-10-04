/**
 * Model-facing session model routing. `switch_model` moves the calling session
 * to another provider/model route through the Host's `sessionController`
 * service, which resolves the selection against the model route, installs it
 * for the Session's next request, and persists it as the deployment default
 * for new sessions. `list_models` reports the routable providers and models
 * so the agent can pick a route. Deployments that mount no session controller
 * (headless, SDK) fail the calls loudly at call time. Named exports preserve
 * loader injection metadata.
 *
 * `switch_model` runs a switch-time fallback ladder: the requested route is
 * tried first, then each entry of the plugin's `fallback` config (priority 1,
 * 2, ...). The first route live in the controller's catalog wins; when none of
 * the candidates are live the call fails with the catalog's provider-failure
 * messages. An in-turn retry (the response itself dying mid-stream) is not
 * reachable from the plugin layer and is tracked separately.
 * @module @deepseek-ai/dsh-tool-model-switch
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
// Type-only: resolves the optional `ctx.sessionController` service declaration
// and the request/value types the tools delegate through.
import type { ModelCatalog, SessionSelectModelRequest } from '@deepseek-ai/dsh-api-session-controller'

export const name = 'tool-model-switch'
export const inject = ['tools']

/** One alternative route the fallback ladder can fall back to. */
export interface FallbackRoute {
  /** Registered provider route id, for example `llamacpp` or `xai`. */
  provider: string
  /** Provider-owned model id, for example `Qwen3.8-27B-Ridge` or `grok-4.6`. */
  model: string
  /** Adapter-owned reasoning effort; omit to follow the provider default. */
  reasoning_effort?: string
}

/**
 * Plugin config, supplied by the row the deployment mounts the plugin on.
 * `fallback` is the priority ladder `switch_model` walks when the requested
 * route is not live. Omit (or leave empty) for no fallback — the requested
 * route is then the only candidate and the call fails if it is not live.
 */
export interface Config {
  fallback?: readonly FallbackRoute[]
}

/**
 * Validate the row config. Throws with a fixed, deployment-actionable message
 * on a malformed `fallback` list so a misconfiguration fails loud at load.
 */
export function validateConfig(value: unknown): Config {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('tool-model-switch: config must be an object with an optional `fallback` list')
  }
  const config = value as Record<string, unknown>
  if (config.fallback === undefined) return {}
  if (typeof config.fallback !== 'object' || config.fallback === null || !Array.isArray(config.fallback)) {
    throw new Error('tool-model-switch: `fallback` must be a list of `{ provider, model }` routes')
  }
  for (const [index, entry] of config.fallback.entries()) {
    const label = `fallback entry ${index + 1}`
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`tool-model-switch: ${label} must be an object with \`provider\` and \`model\``)
    }
    const route = entry as Record<string, unknown>
    if (typeof route.provider !== 'string' || route.provider === '') {
      throw new Error(`tool-model-switch: ${label} has a missing or non-string \`provider\``)
    }
    if (typeof route.model !== 'string' || route.model === '') {
      throw new Error(`tool-model-switch: ${label} has a missing or non-string \`model\``)
    }
    if (route.reasoning_effort !== undefined && typeof route.reasoning_effort !== 'string') {
      throw new Error(`tool-model-switch: ${label} has a non-string \`reasoning_effort\``)
    }
  }
  return value as Config
}

/**
 * Standard-schema validator the composition reads as `Plugin.Config` and applies
 * to the row's config before the plugin starts (`runtime.Config['~standard'].validate`),
 * so the priority list is validated at load rather than trusted raw. Mirrors
 * {@link validateConfig}; `apply` re-validates regardless, so this is belt and
 * braces.
 */
export const Config: { readonly '~standard': { readonly version: 1; readonly validate: (value: unknown) => Config } } = {
  '~standard': {
    version: 1,
    validate: (value) => validateConfig(value),
  },
}

const SWITCH_MODEL_DESCRIPTION =
  'Switch the LLM model that this session runs on. The switch takes effect from the agent\'s next model request '
  + 'and is recorded in the session log. The deployment default for new sessions is also updated to the selected route. '
  + 'Call list_models first to see which providers and models are available. Useful when you need to free GPU memory '
  + 'for a local task: switch to a lighter or differently placed model, run the task, then switch back.'

const LIST_MODELS_DESCRIPTION =
  'List the LLM providers and models this deployment can route to, the current default selection, '
  + 'and any providers whose catalog failed to load. Call it before switch_model.'

/**
 * Register the `switch_model` and `list_models` tools on `ctx.tools`. Both
 * delegate to the `sessionController` service lazily, so the package mounts
 * in every preset; only a call in a controller-less deployment fails.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - the row config, validated; its `fallback` list drives the ladder.
 */
export function apply(ctx: Context, config?: Config): void {
  const fallback = validateConfig(config).fallback

  ctx.tools.register(defineTool({
    name: 'switch_model',
    description: SWITCH_MODEL_DESCRIPTION,
    parameters: {
      provider: { type: 'string', required: true, description: 'Registered provider route id, for example "llama-cpp".' },
      model: { type: 'string', required: true, description: 'Provider-owned model id, for example "Qwen3.8-27B-Ridge".' },
      reasoning_effort: { type: 'string', description: 'Optional adapter-owned reasoning effort id; omit for the provider default.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: async (args, exec) => {
      const agent = exec.agent
      if (agent === undefined) throw new Error('switch_model: no agent context for this call')
      const controller = ctx.get('sessionController')
      if (controller === undefined) throw new Error('switch_model: the session controller is not available in this deployment')

      const requestedEffort = args.reasoning_effort !== undefined && args.reasoning_effort !== '' ? args.reasoning_effort : undefined

      // Candidate ladder: the requested route first, then the `fallback` list
      // in priority order, deduped so a repeated route is not tried twice.
      const candidates: { provider: string; model: string; reasoningEffort?: string }[] = [
        { provider: args.provider, model: args.model, ...(requestedEffort !== undefined ? { reasoningEffort: requestedEffort } : {}) },
      ]
      if (fallback !== undefined) {
        for (const route of fallback) {
          const isDuplicate = candidates.some((c) => c.provider === route.provider && c.model === route.model)
          if (isDuplicate) continue
          candidates.push({
            provider: route.provider,
            model: route.model,
            ...(route.reasoning_effort !== undefined ? { reasoningEffort: route.reasoning_effort } : {}),
          })
        }
      }

      const catalog: ModelCatalog = await controller.modelCatalog()
      const available = candidates.find((c) => isLiveInCatalog(catalog, c.provider, c.model))
      if (available === undefined) {
        const failures = catalog.failures.map((f) => `${f.id} — ${f.message}`).join('; ')
        const detail = failures !== '' ? ` Known provider failures: ${failures}.` : ''
        throw new Error(`switch_model: none of the ${candidates.length} candidate route(s) are currently available.${detail}`)
      }

      const request: SessionSelectModelRequest = {
        sessionId: agent.id,
        provider: available.provider,
        model: available.model,
        ...(available.reasoningEffort !== undefined ? { reasoningEffort: available.reasoningEffort } : {}),
      }
      const result = await controller.selectModel(request)
      const selected = result.selected
      let text = `Switched this session's model to ${selected.provider}/${selected.model}`
      if (selected.reasoningEffort !== undefined) text += ` (reasoning effort ${selected.reasoningEffort})`
      text += '. Effective from the next model request; the default for new sessions now matches this selection.'

      const usedFallback = selected.provider !== args.provider || selected.model !== args.model
      if (usedFallback) {
        const position = candidates.findIndex((c) => c.provider === selected.provider && c.model === selected.model)
        text += ` The requested route was unavailable; priority ${position + 1} of ${candidates.length} was used instead.`
      }
      return text
    },
    presentCall: args => ({ card: 'generic', title: 'Switch session model', kind: 'other', rawInput: args }),
  }))
  ctx.tools.register(defineTool({
    name: 'list_models',
    description: LIST_MODELS_DESCRIPTION,
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: async () => {
      const controller = ctx.get('sessionController')
      if (controller === undefined) throw new Error('list_models: the session controller is not available in this deployment')
      const catalog: ModelCatalog = await controller.modelCatalog()
      const lines = [`Default: ${catalog.default.provider}/${catalog.default.model}`]
      for (const group of catalog.groups) {
        lines.push(group.name === group.id ? group.id : `${group.id} (${group.name}):`)
        for (const model of group.models) {
          lines.push(model.description !== undefined && model.description !== ''
            ? `  ${model.id} — ${model.description}`
            : `  ${model.id}`)
        }
      }
      for (const failure of catalog.failures) lines.push(`unavailable: ${failure.id} — ${failure.message}`)
      return lines.join('\n')
    },
    presentCall: () => ({ card: 'generic', title: 'List available models', kind: 'other', rawInput: {} }),
  }))
}

/**
 * A candidate route is live when its provider group is in the catalog (the
 * provider loaded) and the model id appears in that group's model list.
 */
function isLiveInCatalog(catalog: ModelCatalog, provider: string, model: string): boolean {
  return catalog.groups.some((group) => group.id === provider && group.models.some((m) => m.id === model))
}
