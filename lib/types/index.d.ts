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
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "tool-model-switch";
export declare const inject: string[];
/**
 * Register the `switch_model` and `list_models` tools on `ctx.tools`. Both
 * delegate to the `sessionController` service lazily, so the package mounts
 * in every preset; only a call in a controller-less deployment fails.
 * @param ctx - registrant context carrying the tool registry.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map