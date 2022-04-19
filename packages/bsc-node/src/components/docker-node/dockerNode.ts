import * as pulumi from "@pulumi/pulumi";
import * as docker from "@pulumi/docker";
import { BscPorts, DockerBsc } from "../docker-bsc";
import { BscOptions } from "../../bsc/options";
import { FileHelpers } from "@proxima-one/pulumi-helpers";
import * as path from "path";

export type BscNodeNetwork = "mainnet";

export interface DockerBscNodeArgs {
  network: pulumi.Input<BscNodeNetwork>;
  dockerNetwork?: pulumi.Input<string>;
  ports?: pulumi.Input<{
    bsc?: BscPorts;
  }>;
  verbose?: boolean;
}

export interface BscNetworkConfig {
  seeds: string[];
  config: string;
  genesis: string;
  image: string;
}

export class DockerBscNode extends pulumi.ComponentResource {
  public readonly bsc: DockerBsc;
  public readonly network?: docker.Network;
  public readonly dataVolume?: docker.Volume;

  public constructor(
    name: string,
    args: DockerBscNodeArgs,
    opts?: pulumi.CustomResourceOptions
  ) {
    super("proxima:DockerBscNode", name, args, opts);

    if (args.dockerNetwork == undefined)
      this.network = new docker.Network(name, {}, { parent: this });

    const networkName = args.dockerNetwork ?? this.network!.name;

    const resolvedArgs = pulumi.output(args);

    this.bsc = new DockerBsc(
      `bor-${name}`,
      {
        ports: resolvedArgs.ports?.apply((x) => x?.bsc),
        imageName: resolvedArgs.apply((args) => configs[args.network].image),
        configFile: resolvedArgs.apply((args) => configs[args.network].config),
        genesisFile: resolvedArgs.apply(
          (args) => configs[args.network].genesis
        ),
        existingNetwork: networkName,
        bscOptions: pulumi.all([resolvedArgs]).apply<BscOptions>(([args]) => {
          return {
            syncMode: "full",
            txLookupLimit: 0,
            misc: {
              diffSync: true,
            },
            networking: {
              maxpeers: 100,
            },
            cache: {
              memory: 25000,
            },
            api: {
              http: {
                address: "0.0.0.0",
                corsDomain: " ",
                port: 8545,
                vhosts: ["*"],
                api: ["eth", "net", "web3"],
              },
              ws: {
                port: 8546,
                address: "0.0.0.0",
                origins: ["*"],
                api: ["eth", "net", "web3"],
              },
            },
          };
        }),
      },
      { parent: this }
    );
  }
}

const configs: Record<BscNodeNetwork, BscNetworkConfig> = {
  mainnet: {
    seeds: [],
    image: "quay.io/proxima.one/bsc-geth:1.1.9",
    config: FileHelpers.resolve(
      path.resolve(__dirname, "networks", "mainnet", "config.toml")
    ).toString("utf8"),
    genesis: FileHelpers.resolve(
      path.resolve(__dirname, "networks", "mainnet", "genesis.json")
    ).toString("utf8"),
  },
};
