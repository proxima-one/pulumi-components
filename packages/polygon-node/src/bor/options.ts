import { geth } from "@proxima-one/pulumi-ethereum-node";

export type BorOptions = geth.GethOptions & {
  network?: BorNetwork;
  misc?: MiscOptions;
};

interface MiscOptions {
  snapshot?: boolean;
  heimdallUrl?: string;
  borLogs?: boolean;
}

export type BorNetwork = "bor-mainnet" | "bor-mumbai" | string;

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
