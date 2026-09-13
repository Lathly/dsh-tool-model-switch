import { defineTool } from "@deepseek-ai/dsh-tools";
//#region lib/types/index.js
/**
* Model-facing session model routing. `switch_model` moves the calling session
* to another provider/model route through the Host's `sessionController`
* service, which resolves the selection against the model route, installs it
* for the Session's next request, and persists it as the deployment default
* for new sessions. `list_models` reports the routable providers and models
* so the agent can pick a route. Deployments that mount no session controller
* (headless, SDK) fail the calls loudly at call time. Named exports preserve
* loader injection metadata.
* @module @deepseek-ai/dsh-tool-model-switch
*/
const name = "tool-model-switch";
const inject = ["tools"];
const SWITCH_MODEL_DESCRIPTION = "Switch the LLM model that this session runs on. The switch takes effect from the agent's next model request and is recorded in the session log. The deployment default for new sessions is also updated to the selected route. Call list_models first to see which providers and models are available. Useful when you need to free GPU memory for a local task: switch to a lighter or differently placed model, run the task, then switch back.";
const LIST_MODELS_DESCRIPTION = "List the LLM providers and models this deployment can route to, the current default selection, and any providers whose catalog failed to load. Call it before switch_model.";
/**
* Register the `switch_model` and `list_models` tools on `ctx.tools`. Both
* delegate to the `sessionController` service lazily, so the package mounts
* in every preset; only a call in a controller-less deployment fails.
* @param ctx - registrant context carrying the tool registry.
*/
function apply(ctx) {
	ctx.tools.register(defineTool({
		name: "switch_model",
		description: SWITCH_MODEL_DESCRIPTION,
		parameters: {
			provider: {
				type: "string",
				required: true,
				description: "Registered provider route id, for example \"llama-cpp\"."
			},
			model: {
				type: "string",
				required: true,
				description: "Provider-owned model id, for example \"Qwen3.8-27B-Ridge\"."
			},
			reasoning_effort: {
				type: "string",
				description: "Optional adapter-owned reasoning effort id; omit for the provider default."
			}
		},
		output: {
			schema: { type: "string" },
			render: (_args, value) => [{
				type: "text",
				text: value
			}]
		},
		execute: async (args, exec) => {
			const agent = exec.agent;
			if (agent === void 0) throw new Error("switch_model: no agent context for this call");
			const controller = ctx.get("sessionController");
			if (controller === void 0) throw new Error("switch_model: the session controller is not available in this deployment");
			const effort = args.reasoning_effort !== void 0 && args.reasoning_effort !== "" ? args.reasoning_effort : void 0;
			const request = {
				sessionId: agent.id,
				provider: args.provider,
				model: args.model,
				...effort !== void 0 ? { reasoningEffort: effort } : {}
			};
			const selected = (await controller.selectModel(request)).selected;
			let text = `Switched this session's model to ${selected.provider}/${selected.model}`;
			if (selected.reasoningEffort !== void 0) text += ` (reasoning effort ${selected.reasoningEffort})`;
			text += ". Effective from the next model request; the default for new sessions now matches this selection.";
			return text;
		},
		presentCall: (args) => ({
			card: "generic",
			title: "Switch session model",
			kind: "other",
			rawInput: args
		})
	}));
	ctx.tools.register(defineTool({
		name: "list_models",
		description: LIST_MODELS_DESCRIPTION,
		parameters: {},
		output: {
			schema: { type: "string" },
			render: (_args, value) => [{
				type: "text",
				text: value
			}]
		},
		execute: async () => {
			const controller = ctx.get("sessionController");
			if (controller === void 0) throw new Error("list_models: the session controller is not available in this deployment");
			const catalog = await controller.modelCatalog();
			const lines = [`Default: ${catalog.default.provider}/${catalog.default.model}`];
			for (const group of catalog.groups) {
				lines.push(group.name === group.id ? group.id : `${group.id} (${group.name}):`);
				for (const model of group.models) lines.push(model.description !== void 0 && model.description !== "" ? `  ${model.id} — ${model.description}` : `  ${model.id}`);
			}
			for (const failure of catalog.failures) lines.push(`unavailable: ${failure.id} — ${failure.message}`);
			return lines.join("\n");
		},
		presentCall: () => ({
			card: "generic",
			title: "List available models",
			kind: "other",
			rawInput: {}
		})
	}));
}
//#endregion
export { apply, inject, name };
