import { geth } from "@proxima-one/pulumi-ethereum-node";

export type BscOptions = geth.GethOptions & {
  misc?: BscMiscOptions;
};

export interface BscMiscOptions {
  diffSync?: boolean;
}

export function optionsToArgs(options: BscOptions): string[] {
  const gethArgs = geth.optionsToArgs(options);

  if (options.misc) gethArgs.push(...miscArgs(options.misc));

  return gethArgs;
}

function miscArgs(opts: BscMiscOptions): string[] {
  const args: string[] = [];

  if (opts.diffSync) args.push("--diffsync");

  return args;
}
