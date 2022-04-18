import { geth } from "@proxima-one/pulumi-ethereum-node";

export type BscOptions = geth.GethOptions;

export function optionsToArgs(options: BscOptions): string[] {
  const gethArgs = geth.optionsToArgs(options);
  return gethArgs;
}
