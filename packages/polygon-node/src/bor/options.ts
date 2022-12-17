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

export function optionsToArgs(options: BorOptions, v3: boolean): string[] {
  const args: string[] = [];

  if (v3) {
    args.push("server");
    const network = options.network;
    delete options.network;

    args.push(...geth.optionsToArgs(options));

    args.push("--chain", network == "bor-mumbai" ? "mumbai" : "mainnet");
  } else {
    args.push(...geth.optionsToArgs(options));
  }

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
