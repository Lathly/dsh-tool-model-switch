/**
 * Model-facing session model routing. `switch_model` moves the calling session
 * to another provider/model route through the Host's `sessionController`
 * service, which resolves the selection against the model route, installs it
 * for the Session's next request, and persists it as the deployment default
 * for new sessions. `list_models` reports the routable providers and models
 * so the agent can pick a route. Deployments that mount no session controller
 * (headless, SDK) fail the calls loudly at call time.
 *
 * The optional `fallback` priority list is consulted when the requested route
 * is not currently live in the model catalog, so an agent that cannot reach its
 * first choice still lands on a working route. Named exports preserve loader
 * injection metadata.
 * @module @deepseek-ai/dsh-tool-model-switch
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "tool-model-switch";
export declare const inject: string[];
/**
 * One entry of the `fallback` priority list: an alternate provider/model route
 * the `switch_model` tool tries after the requested route, in list order.
 */
export interface FallbackRoute {
  provider: string;
  model: string;
  reasoning_effort?: string;
}
/**
 * Row config for the plugin: the ordered list of fallback routes to try when
 * the requested route is unavailable.
 */
export interface Config {
  fallback?: readonly FallbackRoute[];
}
/**
 * Validate a raw config value into a normalized {@link Config}. Accepts
 * `undefined`/`null` (no fallback) and rejects non-object config, non-list
 * `fallback`, and entries missing a provider or model.
 * @param value - the raw config.
 * @returns the validated config.
 */
export declare function validateConfig(value: unknown): Config;
declare const Config: {
  readonly '~standard': {
    readonly version: 1;
    readonly validate: (value: unknown) => Config;
  };
};
export { Config };
/**
 * Register the `switch_model` and `list_models` tools on `ctx.tools`. Both
 * delegate to the `sessionController` service lazily, so the package mounts
 * in every preset; only a call in a controller-less deployment fails.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - the row config (validated against `validateConfig`).
 */
export declare function apply(ctx: Context, config?: Config): void;
