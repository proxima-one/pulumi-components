/*
--syncmode "snap" --mainnet --http --txlookuplimit 0 --http.vhosts "*" --cache 4096 --http.addr "0.0.0.0" --http.corsdomain ""
--http.port "8545" --http.api "eth, net, web3, personal" --ws --ws.port "8546" --ws.addr "0.0.0.0" --ws.origins "*"
--ws.api "web3, net, eth" --maxpeers=100
 */

export interface GethOptions {
  /*
   Blockchain sync mode ("snap", "full" or "light") (default: snap)
   */
  syncMode?: SyncMode;

  /*
  Number of recent blocks to maintain transactions index for (default = about one year, 0 = entire chain) (default: 2350000)
  */
  txLookupLimit?: number;

  dataDir?: string;

  /*
  Network to connect to, default "mainnet"
   */
  network?: Network;
  networking?: NetworkingOptions;
  api?: ApiOptions;
  cache?: CacheOptions;
  extraArgs?: string[];
}

interface ApiOptions {
  http?: HttpOptions;
  ws?: WsOptions;
}

interface NetworkingOptions {
  /*
  Comma separated enode URLs for P2P discovery bootstrap
   */
  bootnodes?: string[];
  /*
  Maximum number of network peers (network disabled if set to 0) (default: 50)
   */
  maxpeers: number;
}

interface CacheOptions {
  /*
  Megabytes of memory allocated to internal caching (default = 4096 mainnet full node, 128 light mode) (default: 1024)
   */
  memory?: number;
  databaseMemoryPercentage?: number;
  trieMemoryPercentage?: number;
  trie?: {
    journal?: string;
    rejournal?: string;
  };
  gcMemoryPercentage?: number;
  snapshotMemoryPercentage?: number;
  noPrefetch?: boolean;
  preImages?: boolean;
}

interface HttpOptions {
  address?: string;
  port?: string | number;
  api?: GethApi[];
  rpcPrefix?: string;
  corsDomain?: string;
  vhosts?: string[];
}

interface WsOptions {
  address?: string;
  port?: string | number;
  api?: GethApi[];
  rpcPrefix?: string;
  origins?: string[];
}

type GethApi = "eth" | "net" | "web3" | "personal" | string;
type SyncMode = "snap" | "full" | "light" | string;
type Network =
  | "mainnet"
  | "goerli"
  | "rinkeby"
  | "ropsten"
  | "sepolia"
  | string;

export function optionsToArgs(options: GethOptions): string[] {
  const args: string[] = [];

  if (options.syncMode != undefined) args.push("--syncmode", options.syncMode);

  if (options.txLookupLimit != undefined)
    args.push("--txlookuplimit", options.txLookupLimit.toString());

  if (options.dataDir != undefined) args.push("--datadir", options.dataDir);

  if (options.network != undefined) args.push(`--${options.network}`);

  if (options.cache != undefined) args.push(...cacheArgs(options.cache));

  if (options.api?.ws != undefined) args.push(...wsArgs(options.api.ws));

  if (options.api?.http != undefined) args.push(...httpArgs(options.api.http));

  if (options.networking != undefined)
    args.push(...networkingArgs(options.networking));

  if (options.extraArgs != undefined) args.push(...options.extraArgs);

  return args;
}

function networkingArgs(opts: NetworkingOptions): string[] {
  const args: string[] = [];
  if (opts.maxpeers != undefined)
    args.push("--maxpeers", opts.maxpeers.toString());

  if (opts.bootnodes != undefined)
    args.push("--bootnodes", opts.bootnodes.join(","));

  return args;
}

function wsArgs(opts: WsOptions): string[] {
  const args: string[] = ["--ws"];

  if (opts.api != undefined) args.push("--ws.api", opts.api.join(","));

  if (opts.port != undefined) args.push("--ws.port", opts.port.toString());

  if (opts.address != undefined) args.push("--ws.addr", opts.address);

  if (opts.rpcPrefix != undefined) args.push("--ws.rpcprefix", opts.rpcPrefix);

  if (opts.origins != undefined)
    args.push("--ws.origins", opts.origins.join(","));

  return args;
}

function httpArgs(opts: HttpOptions): string[] {
  const args: string[] = ["--http"];

  if (opts.api != undefined) args.push("--http.api", opts.api.join(","));

  if (opts.port != undefined) args.push("--http.port", opts.port.toString());

  if (opts.address != undefined) args.push("--http.addr", opts.address);

  if (opts.vhosts != undefined)
    args.push("--http.vhosts", opts.vhosts.join(","));

  if (opts.rpcPrefix != undefined)
    args.push("--http.rpcprefix", opts.rpcPrefix);

  if (opts.corsDomain != undefined)
    args.push("--http.corsdomain", opts.corsDomain);

  return args;
}

function cacheArgs(opts: CacheOptions): string[] {
  const args: string[] = [];
  if (opts.memory != undefined) args.push("--cache", opts.memory.toString());

  if (opts.databaseMemoryPercentage != undefined)
    args.push("--cache.database", opts.databaseMemoryPercentage.toString());

  if (opts.trieMemoryPercentage != undefined)
    args.push("--cache.trie", opts.trieMemoryPercentage.toString());

  if (opts.trie?.journal != undefined)
    args.push("--cache.trie.journal", opts.trie.journal);

  if (opts.trie?.rejournal != undefined)
    args.push("--cache.trie.rejournal", opts.trie.rejournal);

  if (opts.gcMemoryPercentage != undefined)
    args.push("--cache.gc", opts.gcMemoryPercentage.toString());

  if (opts.snapshotMemoryPercentage != undefined)
    args.push("--cache.snapshot", opts.snapshotMemoryPercentage.toString());

  if (opts.noPrefetch == true) args.push("--cache.noprefetch");

  if (opts.preImages == true) args.push("--cache.preimages");

  return args;
}
