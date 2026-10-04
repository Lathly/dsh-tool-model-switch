import { defineTool } from "@deepseek-ai/dsh-tools";
const name = "tool-model-switch";
const inject = ["tools"];
function validateConfig(value) {
  if (value === void 0 || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("tool-model-switch: config must be an object with an optional `fallback` list");
  }
  const config = value;
  if (config.fallback === void 0) return {};
  if (typeof config.fallback !== "object" || config.fallback === null || !Array.isArray(config.fallback)) {
    throw new Error("tool-model-switch: `fallback` must be a list of `{ provider, model }` routes");
  }
  for (const [index, entry] of config.fallback.entries()) {
    const label = `fallback entry ${index + 1}`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`tool-model-switch: ${label} must be an object with \`provider\` and \`model\``);
    }
    const route = entry;
    if (typeof route.provider !== "string" || route.provider === "") {
      throw new Error(`tool-model-switch: ${label} has a missing or non-string \`provider\``);
    }
    if (typeof route.model !== "string" || route.model === "") {
      throw new Error(`tool-model-switch: ${label} has a missing or non-string \`model\``);
    }
    if (route.reasoning_effort !== void 0 && typeof route.reasoning_effort !== "string") {
      throw new Error(`tool-model-switch: ${label} has a non-string \`reasoning_effort\``);
    }
  }
  return value;
}
const Config = {
  "~standard": {
    version: 1,
    validate: (value) => validateConfig(value)
  }
};
const SWITCH_MODEL_DESCRIPTION = "Switch the LLM model that this session runs on. The switch takes effect from the agent's next model request and is recorded in the session log. The deployment default for new sessions is also updated to the selected route. Call list_models first to see which providers and models are available. Useful when you need to free GPU memory for a local task: switch to a lighter or differently placed model, run the task, then switch back.";
const LIST_MODELS_DESCRIPTION = "List the LLM providers and models this deployment can route to, the current default selection, and any providers whose catalog failed to load. Call it before switch_model.";
function apply(ctx, config) {
  const fallback = validateConfig(config).fallback;
  ctx.tools.register(defineTool({
    name: "switch_model",
    description: SWITCH_MODEL_DESCRIPTION,
    parameters: {
      provider: { type: "string", required: true, description: 'Registered provider route id, for example "llama-cpp".' },
      model: { type: "string", required: true, description: 'Provider-owned model id, for example "Qwen3.8-27B-Ridge".' },
      reasoning_effort: { type: "string", description: "Optional adapter-owned reasoning effort id; omit for the provider default." }
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }]
    },
    execute: async (args, exec) => {
      const agent = exec.agent;
      if (agent === void 0) throw new Error("switch_model: no agent context for this call");
      const controller = ctx.get("sessionController");
      if (controller === void 0) throw new Error("switch_model: the session controller is not available in this deployment");
      const requestedEffort = args.reasoning_effort !== void 0 && args.reasoning_effort !== "" ? args.reasoning_effort : void 0;
      const candidates = [
        { provider: args.provider, model: args.model, ...requestedEffort !== void 0 ? { reasoningEffort: requestedEffort } : {} }
      ];
      if (fallback !== void 0) {
        for (const route of fallback) {
          const isDuplicate = candidates.some((c) => c.provider === route.provider && c.model === route.model);
          if (isDuplicate) continue;
          candidates.push({
            provider: route.provider,
            model: route.model,
            ...route.reasoning_effort !== void 0 ? { reasoningEffort: route.reasoning_effort } : {}
          });
        }
      }
      const catalog = await controller.modelCatalog();
      const available = candidates.find((c) => isLiveInCatalog(catalog, c.provider, c.model));
      if (available === void 0) {
        const failures = catalog.failures.map((f) => `${f.id} \u2014 ${f.message}`).join("; ");
        const detail = failures !== "" ? ` Known provider failures: ${failures}.` : "";
        throw new Error(`switch_model: none of the ${candidates.length} candidate route(s) are currently available.${detail}`);
      }
      const request = {
        sessionId: agent.id,
        provider: available.provider,
        model: available.model,
        ...available.reasoningEffort !== void 0 ? { reasoningEffort: available.reasoningEffort } : {}
      };
      const result = await controller.selectModel(request);
      const selected = result.selected;
      let text = `Switched this session's model to ${selected.provider}/${selected.model}`;
      if (selected.reasoningEffort !== void 0) text += ` (reasoning effort ${selected.reasoningEffort})`;
      text += ". Effective from the next model request; the default for new sessions now matches this selection.";
      const usedFallback = selected.provider !== args.provider || selected.model !== args.model;
      if (usedFallback) {
        const position = candidates.findIndex((c) => c.provider === selected.provider && c.model === selected.model);
        text += ` The requested route was unavailable; priority ${position + 1} of ${candidates.length} was used instead.`;
      }
      return text;
    },
    presentCall: (args) => ({ card: "generic", title: "Switch session model", kind: "other", rawInput: args })
  }));
  ctx.tools.register(defineTool({
    name: "list_models",
    description: LIST_MODELS_DESCRIPTION,
    parameters: {},
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }]
    },
    execute: async () => {
      const controller = ctx.get("sessionController");
      if (controller === void 0) throw new Error("list_models: the session controller is not available in this deployment");
      const catalog = await controller.modelCatalog();
      const lines = [`Default: ${catalog.default.provider}/${catalog.default.model}`];
      for (const group of catalog.groups) {
        lines.push(group.name === group.id ? group.id : `${group.id} (${group.name}):`);
        for (const model of group.models) {
          lines.push(model.description !== void 0 && model.description !== "" ? `  ${model.id} \u2014 ${model.description}` : `  ${model.id}`);
        }
      }
      for (const failure of catalog.failures) lines.push(`unavailable: ${failure.id} \u2014 ${failure.message}`);
      return lines.join("\n");
    },
    presentCall: () => ({ card: "generic", title: "List available models", kind: "other", rawInput: {} })
  }));
}
function isLiveInCatalog(catalog, provider, model) {
  return catalog.groups.some((group) => group.id === provider && group.models.some((m) => m.id === model));
}
export {
  Config,
  apply,
  inject,
  name,
  validateConfig
};
