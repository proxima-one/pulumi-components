import * as pulumi from "@pulumi/pulumi";
import * as docker from "@pulumi/docker";
import * as _ from "lodash";
import { input as inputs } from "@pulumi/docker/types";
import { FileHelpers } from "@proxima-one/pulumi-helpers";
import * as path from "path";
import { Unwrap } from "@pulumi/pulumi";

export interface DockerHeimdallArgs {
  /*
    Sample: maticnetwork/heimdall:v0.2.9
   */
  imageName?: pulumi.Input<string>;
  existingNetwork?: pulumi.Input<string>;
  existingDataVolume?: pulumi.Input<string>;
  extraVolumes?: pulumi.Input<pulumi.Input<inputs.ContainerVolume>[]>;
  heimdallOptions?: pulumi.Input<HeimdallOptions>;
  /*
  Expose host ports: { [hostPort]: [containerPort]}
   */
  ports?: HeimdallPorts;
}

export interface HeimdallPorts {
  restServer?: number;
  p2p?: number;
  rpc?: number;
  rabbitmq?: number;
}

const defaultOptions: HeimdallOptions = {
  ethRpcUrl: "http://eth:8545",
  borRpcUrl: "http://bor:8545",
  network: "mainnet-v1",
};

export interface HeimdallOptions {
  ethRpcUrl?: pulumi.Input<string>;
  borRpcUrl?: pulumi.Input<string>;
  network?: pulumi.Input<"mainnet-v1" | "testnet-v4">;
  seeds?: string[];
}

const dataDir = "/root/.heimdalld";
const defaultImageName = "maticnetwork/heimdall:v0.2.9";

export class DockerHeimdall extends pulumi.ComponentResource {
  public readonly heimdallOptions: pulumi.Output<Unwrap<HeimdallOptions>>;
  public readonly cliArgs: pulumi.Output<string[]>;
  public readonly network?: docker.Network;
  public readonly daemonContainer: docker.Container;
  public readonly restServerContainer: docker.Container;
  public readonly dataVolume?: docker.Volume;
  public readonly rabbitMqContainer: docker.Container;

  public constructor(
    name: string,
    args: DockerHeimdallArgs,
    opts?: pulumi.CustomResourceOptions
  ) {
    super("proxima:DockerHeimdall", name, args, opts);

    if (args.existingNetwork == undefined)
      this.network = new docker.Network(name, {}, { parent: this });

    const networkName = args.existingNetwork ?? this.network!.name;

    const heimdallImage = new docker.RemoteImage(
      name,
      {
        name: args.imageName || defaultImageName,
        keepLocally: true,
      },
      { parent: this }
    );

    this.heimdallOptions = pulumi.Output.create(
      args.heimdallOptions ?? {}
    ).apply((options) => _.merge(defaultOptions, options));
    this.cliArgs = this.heimdallOptions.apply((options) => [
      "start",
      "--moniker",
      name,
      "--rpc.laddr",
      "tcp://0.0.0.0:26657",
    ]);

    if (args.existingDataVolume == undefined)
      this.dataVolume = new docker.Volume(name, {}, { parent: this });

    const dataVolumeName = args.existingDataVolume ?? this.dataVolume!.name;

    const extraVolumes: pulumi.Input<pulumi.Input<inputs.ContainerVolume>[]> =
      args.extraVolumes ?? [];
    const volumes: pulumi.Output<pulumi.Input<inputs.ContainerVolume>[]> =
      pulumi.Output.create(extraVolumes).apply((x) =>
        [
          {
            volumeName: dataVolumeName,
            containerPath: dataDir,
          } as pulumi.Input<inputs.ContainerVolume>,
        ].concat(x)
      );

    const entrypointPath = "/scripts/entrypoint.sh";

    const genesisFile = this.heimdallOptions.network!.apply((network) =>
      path.resolve(__dirname, "networks", network!, "genesis.json")
    );

    this.rabbitMqContainer = new docker.Container(
      `${name}-rabbitmq`,
      {
        image: "rabbitmq:3-alpine",
        networksAdvanced: [{ name: networkName }],
        restart: "unless-stopped",
        ports: args.ports?.rabbitmq
          ? [{ external: args.ports?.rabbitmq, internal: 5672 }]
          : [],
      },
      { parent: this }
    );

    const ctx = pulumi
      .all([this.heimdallOptions, this.rabbitMqContainer.name])
      .apply(([opts, rmqName]) => {
        return pulumi.all({
          ethRpcUrl: opts.ethRpcUrl,
          borRpcUrl: opts.borRpcUrl,
          amqpUrl: `amqp://guest:guest@${rmqName}:5672/`,
          seeds: (opts.seeds ?? []).join(","),
        });
      });

    this.daemonContainer = new docker.Container(
      `${name}-daemon`,
      {
        image: heimdallImage.name,
        restart: "unless-stopped",
        networksAdvanced: [{ name: networkName }],
        envs: [pulumi.concat(`DATA_DIR=`, dataDir)],
        entrypoints: [entrypointPath],
        command: this.cliArgs,
        volumes: volumes,
        ports: [
          ...(args.ports?.p2p
            ? [{ external: args.ports?.p2p, internal: 26656 }]
            : []),
          ...(args.ports?.rpc
            ? [{ external: args.ports?.rpc, internal: 26657 }]
            : []),
        ],
        uploads: [
          {
            file: entrypointPath,
            executable: true,
            source: path.resolve(__dirname, "entrypoint.sh"),
          },
          {
            file: pulumi.concat(dataDir, "/proxima/genesis.json"),
            source: genesisFile,
          },
          {
            file: pulumi.concat(dataDir, "/proxima/heimdall-config.toml"),
            content: ctx.apply((x) =>
              FileHelpers.template(
                path.resolve(__dirname, "heimdall-config.toml.hbs"),
                x
              ).toString("utf8")
            ),
          },
          {
            file: pulumi.concat(dataDir, "/proxima/config.toml"),
            content: ctx.apply((x) =>
              FileHelpers.template(
                path.resolve(__dirname, "config.toml.hbs"),
                x
              ).toString("utf8")
            ),
          },
        ],
      },
      { parent: this, dependsOn: this.rabbitMqContainer }
    );

    this.restServerContainer = new docker.Container(
      `${name}-rest-server`,
      {
        image: heimdallImage.name,
        restart: "unless-stopped",
        networksAdvanced: [{ name: networkName }],
        command: [
          "heimdalld",
          "rest-server",
          //"--chain-id", "",
          "--laddr",
          "tcp://0.0.0.0:1317",
          "--node",
          this.daemonContainer.name.apply((x) => `tcp://${x}:26657`),
        ],
        volumes: volumes,
        ports: [
          ...(args.ports?.restServer
            ? [{ external: args.ports?.restServer, internal: 1317 }]
            : []),
        ],
      },
      { parent: this, dependsOn: this.daemonContainer }
    );

    this.registerOutputs([this.heimdallOptions, this.cliArgs]);
  }
}
