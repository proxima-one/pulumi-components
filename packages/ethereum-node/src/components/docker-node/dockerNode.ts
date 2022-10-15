import * as pulumi from "@pulumi/pulumi";
import * as docker from "@pulumi/docker";
import * as random from "@pulumi/random";

import { DockerGeth, GethPorts } from "../docker-geth";
import { DockerPrysm, PrysmPorts } from "../docker-prysm";
import { GethOptions } from "../../geth";
import * as net from "net";

export type EthNodeNetwork = "mainnet" | "goerli";
export interface DockerEthNodeArgs {
  network: EthNodeNetwork;
  dockerNetwork?: pulumi.Input<string>;
  ports?: pulumi.Input<{
    geth?: GethPorts;
    prysm?: PrysmPorts;
  }>;
  gethDataVolume?: pulumi.Input<string>;
  archival?: pulumi.Input<boolean>;
  checkpointUrl?: pulumi.Input<string>;
}

export interface EthNetworkConfig {
  gethImage: string;
  prysmImage: string;
  checkpointUrl: string;
}

export class DockerEthNode extends pulumi.ComponentResource {
  public readonly geth: DockerGeth;
  public readonly prysm: DockerPrysm;
  public readonly network?: docker.Network;
  public readonly gethDataVolume?: docker.Volume;

  public constructor(
    name: string,
    args: DockerEthNodeArgs,
    opts?: pulumi.CustomResourceOptions
  ) {
    super("proxima:DockerEthNode", name, args, opts);

    if (args.dockerNetwork == undefined)
      this.network = new docker.Network(name, {}, { parent: this });

    const networkName = args.dockerNetwork ?? this.network!.name;

    if (args.gethDataVolume == undefined)
      this.gethDataVolume = new docker.Volume(name, {}, { parent: this });

    const gethDataVolumeName = args.gethDataVolume ?? this.gethDataVolume!.name;
    const jwtSecret = new random.RandomId(
      `${name}-jwt`,
      {
        byteLength: 32,
      },
      { parent: this }
    ).hex;

    const resolvedArgs = pulumi.output(args);
    this.geth = new DockerGeth(
      `${name}`,
      {
        existingNetwork: networkName,
        imageName: resolvedArgs.apply(
          (args) => configs[args.network].gethImage
        ),
        ports: resolvedArgs.apply((x) => x.ports?.geth),
        existingDataVolume: gethDataVolumeName,
        jwtSecret: jwtSecret,
        gethOptions: pulumi
          .all([resolvedArgs, jwtSecret])
          .apply<GethOptions>(([args, jwtSecret]) => ({
            syncMode: "snap",
            network: args.network,
            txLookupLimit: 0,
            archival: args.archival,
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
                api: ["eth", "net", "web3", "personal"],
              },
              ws: {
                port: 8546,
                address: "0.0.0.0",
                origins: ["*"],
                api: ["eth", "net", "web3", "personal"],
              },
              auth: {
                address: "0.0.0.0",
                port: 8551,
                vhosts: ["*"],
                jwtSecret: "/proxima/jwt.hex",
              },
            },
          })),
      },
      { parent: this }
    );

    this.prysm = new DockerPrysm(
      `${name}`,
      {
        network: toPrysmNetwork(args.network),
        ports: resolvedArgs.apply((x) => x.ports?.prysm),
        imageName: resolvedArgs.apply(
          (args) => configs[args.network].prysmImage
        ),
        jwtSecret: jwtSecret,
        executionEndpoint: pulumi.interpolate`http://${this.geth.container.domainname}:8551`,
        existingNetwork: networkName,
        checkpointUrl:
          configs[args.network].checkpointUrl ?? args.checkpointUrl,
      },
      { parent: this }
    );
  }
}

function toPrysmNetwork(network: EthNodeNetwork) {
  switch (network) {
    case "mainnet":
      return "mainnet";
    case "goerli":
      return "goerli-prater";
  }
}

const configs: Record<EthNodeNetwork, EthNetworkConfig> = {
  mainnet: {
    gethImage: "ethereum/client-go:v1.10.25",
    prysmImage: "gcr.io/prysmaticlabs/prysm/beacon-chain:v3.1.1",
    checkpointUrl: "https://mainnet.checkpoint.sigp.io",
  },
  goerli: {
    gethImage: "ethereum/client-go:v1.10.25",
    prysmImage: "gcr.io/prysmaticlabs/prysm/beacon-chain:v3.1.1",
    checkpointUrl: "https://goerli.checkpoint-sync.ethpandaops.io",
  },
};
