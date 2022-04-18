import { geth } from "@proxima-one/pulumi-ethereum-node";

export type BorOptions = geth.GethOptions & {
  network?: Network;
  misc?: MiscOptions;
};

interface MiscOptions {
  snapshot?: boolean;
  heimdallUrl?: string;
  borLogs?: boolean;
}

type Network = "bor-mainnet" | "bor-mumbai";

export function optionsToArgs(options: BorOptions): string[] {
  const args: string[] = [];

  args.push(...geth.optionsToArgs(options));

  if (options.misc) args.push(...miscArgs(options.misc));

  return args;
}

function miscArgs(opts: MiscOptions): string[] {
  const args: string[] = [];
  if (opts.snapshot) args.push("--snapshot");

  if (opts.borLogs) args.push("--bor.logs");

  if (opts.heimdallUrl) args.push("--bor.heimdall", opts.heimdallUrl);

  return args;
}
