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
  ports?: pulumi.Input<HeimdallPorts | undefined>;
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

export type HeimdallNetwork = "mainnet-v1" | "testnet-v4";
export interface HeimdallOptions {
  ethRpcUrl?: pulumi.Input<string>;
  borRpcUrl?: pulumi.Input<string>;
  network?: pulumi.Input<HeimdallNetwork>;
  seeds?: string[];
  logLevel?: string;
}

const dataDir = "/var/lib/heimdall";
const defaultImageName = "0xpolygon/heimdall:0.2.9";

export class DockerHeimdall extends pulumi.ComponentResource {
  public readonly heimdallOptions: pulumi.Output<Unwrap<HeimdallOptions>>;
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

    const resolvedArgs = pulumi.output(args);
    this.heimdallOptions = pulumi.Output.create(
      args.heimdallOptions ?? {}
    ).apply((options) => _.merge(defaultOptions, options));

    const commonCliArgs = this.heimdallOptions.apply((options) => {
      const res = [];

      if (options.logLevel) res.push("--log_level", options.logLevel);

      return res;
    });

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
        restart: "always",
        ports: resolvedArgs.ports?.apply((ports) =>
          ports?.rabbitmq ? [{ external: ports?.rabbitmq, internal: 5672 }] : []
        ),
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

    const heimdallCommon = {
      networksAdvanced: [{ name: networkName }],
      envs: [pulumi.concat(`DATA_DIR=`, dataDir)],
      image: heimdallImage.name,
      restart: "always",
      volumes: volumes,
      entrypoints: [entrypointPath],
      uploads: [
        {
          file: entrypointPath,
          executable: true,
          source: path.resolve(__dirname, "entrypoint.sh"),
        },
        {
          file: "/proxima/genesis.json",
          source: genesisFile,
        },
        {
          file: "/proxima/heimdall-config.toml",
          content: ctx.apply((x) =>
            FileHelpers.template(
              path.resolve(__dirname, "heimdall-config.toml.hbs"),
              x
            ).toString("utf8")
          ),
        },
        {
          file: "/proxima/config.toml",
          content: ctx.apply((x) =>
            FileHelpers.template(
              path.resolve(__dirname, "config.toml.hbs"),
              x
            ).toString("utf8")
          ),
        },
      ],
    };

    this.daemonContainer = new docker.Container(
      `${name}-daemon`,
      {
        ...heimdallCommon,
        hostname: `${name}-daemon`,
        domainname: `${name}-daemon`,
        command: commonCliArgs.apply((x) => [
          "start",
          "--home",
          dataDir,
          "--moniker",
          name,
          "--rpc.laddr",
          "tcp://0.0.0.0:26657",
          ...x,
        ]),
        ports: resolvedArgs.ports?.apply((ports) => [
          ...(ports?.p2p ? [{ external: ports?.p2p, internal: 26656 }] : []),
          ...(ports?.rpc ? [{ external: ports?.rpc, internal: 26657 }] : []),
        ]),
      },
      { parent: this, dependsOn: this.rabbitMqContainer }
    );

    this.restServerContainer = new docker.Container(
      `${name}-rest-server`,
      {
        ...heimdallCommon,
        hostname: `${name}-rest-server`,
        domainname: `${name}-rest-server`,
        command: commonCliArgs.apply((x) => [
          "rest-server",
          "--home",
          dataDir,
          "--laddr",
          "tcp://0.0.0.0:1317",
          "--node",
          this.daemonContainer.domainname.apply((x) => `tcp://${x}:26657`),
          ...x,
        ]),
        ports: resolvedArgs.ports?.apply((ports) =>
          ports?.restServer
            ? [{ external: ports?.restServer, internal: 1317 }]
            : []
        ),
      },
      { parent: this, dependsOn: this.daemonContainer }
    );

    this.registerOutputs([this.heimdallOptions]);
  }
}
