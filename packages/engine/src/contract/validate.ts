import { contractRegistry, isContractName, type CheckResult, type Contract } from "@handoff/core";
import type { core } from "zod";
import { runCheck, type CheckContext } from "./checks.ts";

export type ContractResult = {
  passed: boolean;
  output?: unknown;
  checks: CheckResult[];
  issues?: core.$ZodIssue[];
  reason?: string;
};

/**
 * Parses the output with the named contract, then runs every deterministic check (all of them, so a
 * retry sees the full picture). An output with status needs_input passes without checks; status
 * failed fails without checks.
 */
export async function validateContract(contract: Contract, output: unknown, ctx: CheckContext): Promise<ContractResult> {
  if (!isContractName(contract.output)) return { passed: false, checks: [], reason: `unknown contract ${contract.output}` };
  const parsed = contractRegistry[contract.output].safeParse(output);
  if (!parsed.success) return { passed: false, checks: [], issues: parsed.error.issues, reason: "output does not match the contract" };
  const status = (parsed.data as { status?: unknown }).status;
  if (status === "needs_input") return { passed: true, output: parsed.data, checks: [] };
  if (status === "failed") return { passed: false, output: parsed.data, checks: [], reason: "node reported failed" };
  const checks: CheckResult[] = [];
  for (const check of contract.checks) {
    try {
      checks.push(await runCheck(check, { ...ctx, output: parsed.data }));
    } catch (error) {
      checks.push({ kind: check.kind, passed: false, detail: `check errored: ${(error as Error).message}` });
    }
  }
  const failed = checks.filter((c) => !c.passed);
  return {
    passed: failed.length === 0,
    output: parsed.data,
    checks,
    ...(failed.length ? { reason: `failed checks: ${failed.map((c) => c.kind).join(", ")}` } : {}),
  };
}
