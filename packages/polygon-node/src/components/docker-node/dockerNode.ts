import * as pulumi from "@pulumi/pulumi";
import * as docker from "@pulumi/docker";
import { BorPorts, DockerBor } from "../docker-bor/dockerBor";
import {
  DockerHeimdall,
  HeimdallNetwork,
  HeimdallPorts,
} from "../docker-heimdall/dockerHeimdall";
import { BorNetwork, BorOptions } from "../../bor";

export type PolygonNodeNetwork = "mainnet" | "mumbai";
export interface DockerPolygonNodeArgs {
  network: pulumi.Input<PolygonNodeNetwork>;
  dockerNetwork?: pulumi.Input<string>;
  ethRpcUrl?: pulumi.Input<string>;
  ports?: pulumi.Input<{
    bor?: BorPorts;
    heimdall?: HeimdallPorts;
  }>;
  verbose?: boolean;
  borImage?: pulumi.Input<string>;
  heimdallImage?: pulumi.Input<string>;
}

export interface PolygonNetworkConfig {
  heimdallSeeds: string[];
  heimdallNetwork: HeimdallNetwork;
  borBootNodes: string[];
  borNetwork: BorNetwork;
  borImage: string;
  heimdallImage: string;
}

export class DockerPolygonNode extends pulumi.ComponentResource {
  public readonly heimdall: DockerHeimdall;
  public readonly bor: DockerBor;
  public readonly network?: docker.Network;
  public readonly dataVolume?: docker.Volume;

  public constructor(
    name: string,
    args: DockerPolygonNodeArgs,
    opts?: pulumi.CustomResourceOptions
  ) {
    super("proxima:DockerPolygonNode", name, args, opts);

    if (args.dockerNetwork == undefined)
      this.network = new docker.Network(name, {}, { parent: this });

    const networkName = args.dockerNetwork ?? this.network!.name;

    const resolvedArgs = pulumi.output(args);
    this.heimdall = new DockerHeimdall(
      `heimdall-${name}`,
      {
        existingNetwork: networkName,
        imageName: resolvedArgs.apply(
          (args) => args.heimdallImage ?? configs[args.network].heimdallImage
        ),
        ports: resolvedArgs.ports?.apply((x) => x?.heimdall),
        heimdallOptions: resolvedArgs.apply((args) => {
          return {
            ethRpcUrl: args.ethRpcUrl,
            network: configs[args.network].heimdallNetwork,
            logLevel: args.verbose ? "*:debug" : undefined,
            seeds: configs[args.network].heimdallSeeds,
          };
        }),
      },
      { parent: this }
    );

    this.bor = new DockerBor(
      `bor-${name}`,
      {
        ports: resolvedArgs.ports?.apply((x) => x?.bor),
        existingNetwork: networkName,
        imageName: resolvedArgs.apply(
          (args) => args.borImage ?? configs[args.network].borImage
        ),
        borOptions: pulumi
          .all([resolvedArgs, this.heimdall.restServerContainer.domainname])
          .apply<BorOptions>(([args, restServ]) => {
            return {
              syncMode: "full",
              misc: {
                heimdallUrl: `http://${restServ}:1317`,
                borLogs: true,
              },
              extraArgs: ["--ipcdisable"],
              network: configs[args.network].borNetwork,
              txLookupLimit: 0,
              networking: {
                maxpeers: 100,
                bootnodes: configs[args.network].borBootNodes,
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
      { parent: this, dependsOn: this.heimdall }
    );
  }
}

const configs: Record<PolygonNodeNetwork, PolygonNetworkConfig> = {
  mainnet: {
    heimdallSeeds: [
      "f4f605d60b8ffaaf15240564e58a81103510631c@159.203.9.164:26656",
      "4fb1bc820088764a564d4f66bba1963d47d82329@44.232.55.71:26656",
    ],
    heimdallNetwork: "mainnet-v1",
    borBootNodes: [
      "enode://0cb82b395094ee4a2915e9714894627de9ed8498fb881cec6db7c65e8b9a5bd7f2f25cc84e71e89d0947e51c76e85d0847de848c7782b13c0255247a6758178c@44.232.55.71:30303",
      "enode://88116f4295f5a31538ae409e4d44ad40d22e44ee9342869e7d68bdec55b0f83c1530355ce8b41fbec0928a7d75a5745d528450d30aec92066ab6ba1ee351d710@159.203.9.164:30303",
    ],
    borNetwork: "bor-mainnet",
    borImage: "0xpolygon/bor:0.2.16",
    heimdallImage: "0xpolygon/heimdall:0.2.11",
  },
  mumbai: {
    heimdallSeeds: [
      "4cd60c1d76e44b05f7dfd8bab3f447b119e87042@54.147.31.250:26656",
      "b18bbe1f3d8576f4b73d9b18976e71c65e839149@34.226.134.117:26656",
    ],
    heimdallNetwork: "testnet-v4",
    borBootNodes: [
      "enode://320553cda00dfc003f499a3ce9598029f364fbb3ed1222fdc20a94d97dcc4d8ba0cd0bfa996579dcc6d17a534741fb0a5da303a90579431259150de66b597251@54.147.31.250:30303",
      "enode://f0f48a8781629f95ff02606081e6e43e4aebd503f3d07fc931fad7dd5ca1ba52bd849a6f6c3be0e375cf13c9ae04d859c4a9ae3546dc8ed4f10aa5dbb47d4998@34.226.134.117:30303",
    ],
    borNetwork: "bor-mumbai",
    borImage: "0xpolygon/bor:0.3.1-mumbai",
    heimdallImage: "0xpolygon/heimdall:0.3.0",
  },
};
