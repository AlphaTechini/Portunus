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
import type * as accessKeys from "../accessKeys.js";
import type * as auth from "../auth.js";
import type * as auth_internal from "../auth_internal.js";
import type * as chain from "../chain.js";
import type * as containers from "../containers.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as demo from "../demo.js";
import type * as deposits from "../deposits.js";
import type * as disputes from "../disputes.js";
import type * as heldTransfers from "../heldTransfers.js";
import type * as helpers from "../helpers.js";
import type * as lifecycle from "../lifecycle.js";
import type * as notifications from "../notifications.js";
import type * as opsDeposits from "../opsDeposits.js";
import type * as opsKeys from "../opsKeys.js";
import type * as opsLifecycle from "../opsLifecycle.js";
import type * as opsRequests from "../opsRequests.js";
import type * as opsSettlement from "../opsSettlement.js";
import type * as orgSetup from "../orgSetup.js";
import type * as orgs from "../orgs.js";
import type * as rateCards from "../rateCards.js";
import type * as releaseRequests from "../releaseRequests.js";
import type * as seed from "../seed.js";
import type * as settlement from "../settlement.js";
import type * as sim from "../sim.js";
import type * as simStore from "../simStore.js";
import type * as sweep from "../sweep.js";
import type * as system from "../system.js";
import type * as tempoNode from "../tempoNode.js";
import type * as views from "../views.js";
import type * as webauthn from "../webauthn.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  accessKeys: typeof accessKeys;
  auth: typeof auth;
  auth_internal: typeof auth_internal;
  chain: typeof chain;
  containers: typeof containers;
  crons: typeof crons;
  dashboard: typeof dashboard;
  demo: typeof demo;
  deposits: typeof deposits;
  disputes: typeof disputes;
  heldTransfers: typeof heldTransfers;
  helpers: typeof helpers;
  lifecycle: typeof lifecycle;
  notifications: typeof notifications;
  opsDeposits: typeof opsDeposits;
  opsKeys: typeof opsKeys;
  opsLifecycle: typeof opsLifecycle;
  opsRequests: typeof opsRequests;
  opsSettlement: typeof opsSettlement;
  orgSetup: typeof orgSetup;
  orgs: typeof orgs;
  rateCards: typeof rateCards;
  releaseRequests: typeof releaseRequests;
  seed: typeof seed;
  settlement: typeof settlement;
  sim: typeof sim;
  simStore: typeof simStore;
  sweep: typeof sweep;
  system: typeof system;
  tempoNode: typeof tempoNode;
  views: typeof views;
  webauthn: typeof webauthn;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
