/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as chain from "../chain.js";
import type * as helpers from "../helpers.js";
import type * as lifecycle from "../lifecycle.js";
import type * as opsDeposits from "../opsDeposits.js";
import type * as opsKeys from "../opsKeys.js";
import type * as opsLifecycle from "../opsLifecycle.js";
import type * as opsRequests from "../opsRequests.js";
import type * as opsSettlement from "../opsSettlement.js";
import type * as orgSetup from "../orgSetup.js";
import type * as settlement from "../settlement.js";
import type * as sim from "../sim.js";
import type * as simStore from "../simStore.js";
import type * as tempoNode from "../tempoNode.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  chain: typeof chain;
  helpers: typeof helpers;
  lifecycle: typeof lifecycle;
  opsDeposits: typeof opsDeposits;
  opsKeys: typeof opsKeys;
  opsLifecycle: typeof opsLifecycle;
  opsRequests: typeof opsRequests;
  opsSettlement: typeof opsSettlement;
  orgSetup: typeof orgSetup;
  settlement: typeof settlement;
  sim: typeof sim;
  simStore: typeof simStore;
  tempoNode: typeof tempoNode;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
