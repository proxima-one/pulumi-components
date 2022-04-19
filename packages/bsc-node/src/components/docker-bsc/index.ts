import * as pulumi from "@pulumi/pulumi";
import * as docker from "@pulumi/docker";
import * as _ from "lodash";
import { input as inputs } from "@pulumi/docker/types";
import { BscOptions, optionsToArgs } from "../../bsc/options";
import path from "path";

export interface DockerBscArgs {
  imageName?: pulumi.Input<string>;
  existingNetwork?: pulumi.Input<string>;
  existingDataVolume?: pulumi.Input<string>;
  bscOptions?: pulumi.Input<BscOptions>;
  extraVolumes?: pulumi.Input<pulumi.Input<inputs.ContainerVolume>[]>;
  ports?: pulumi.Input<BscPorts | undefined>;

  configFile?: pulumi.Input<string | undefined>;
  genesisFile?: pulumi.Input<string | undefined>;
}

export interface BscPorts {
  rpc?: number;
  ws?: number;
  peers?: number;
}

const defaultBscOptions: BscOptions = {
  dataDir: "/root/.ethereum",
};

const defaultImageName = "quay.io/proxima.one/bsc-geth:1.1.8";

const entrypointPath = "/scripts/entrypoint.sh";
const configFilePath = "/proxima/config.toml";
export class DockerBsc extends pulumi.ComponentResource {
  public readonly bscOptions: pulumi.Output<BscOptions>;
  public readonly bscCommandArgs: pulumi.Output<string[]>;
  public readonly container: docker.Container;
  public readonly network?: docker.Network;
  public readonly dataVolume?: docker.Volume;

  public constructor(
    name: string,
    args: DockerBscArgs,
    opts?: pulumi.CustomResourceOptions
  ) {
    super("proxima:DockerBsc", name, args, opts);

    if (args.existingNetwork == undefined)
      this.network = new docker.Network(name, {}, { parent: this });

    const networkName = args.existingNetwork ?? this.network!.name;

    const bscImage = new docker.RemoteImage(
      name,
      {
        name: args.imageName ?? defaultImageName,
        keepLocally: true,
      },
      { parent: this }
    );

    const resolvedArgs = pulumi.output(args);

    this.bscOptions = pulumi.Output.create(args.bscOptions ?? {}).apply(
      (options) => _.merge(defaultBscOptions, options)
    );
    this.bscCommandArgs = pulumi
      .all([resolvedArgs, this.bscOptions])
      .apply(([args, options]) => {
        const res = optionsToArgs(options);

        if (args.configFile) res.push("--config", configFilePath);

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
            containerPath: this.bscOptions.apply((x) => x.dataDir!),
          } as pulumi.Input<inputs.ContainerVolume>,
        ].concat(x)
      );

    const containerCommon = {
      networksAdvanced: [{ name: networkName }],
      envs: [pulumi.concat(`DATA_DIR=`, this.bscOptions.dataDir)],
      image: bscImage.name,
      restart: "unless-stopped",
      volumes: volumes,
      entrypoints: [entrypointPath],
      uploads: resolvedArgs.apply((args) => [
        {
          file: entrypointPath,
          executable: true,
          source: path.resolve(__dirname, "entrypoint.sh"),
        },
        ...(args.genesisFile
          ? [
              {
                file: "/proxima/genesis.json",
                content: args.genesisFile,
              },
            ]
          : []),
        ...(args.configFile
          ? [
              {
                file: configFilePath,
                content: args.configFile,
              },
            ]
          : []),
      ]),
    };

    this.container = new docker.Container(
      name,
      {
        ...containerCommon,
        command: this.bscCommandArgs,
        ports: resolvedArgs.ports?.apply((ports) => [
          ...(ports?.rpc
            ? [
                {
                  external: ports?.rpc,
                  internal: this.bscOptions.apply(
                    (x) => x.api?.http?.port ?? 8545
                  ),
                },
              ]
            : []),
          ...(ports?.ws
            ? [
                {
                  external: ports?.ws,
                  internal: this.bscOptions.apply(
                    (x) => x.api?.ws?.port ?? 8546
                  ),
                },
              ]
            : []),
          ...(ports?.peers
            ? [
                {
                  external: ports?.peers,
                  internal: 30303,
                  protocol: "tcp",
                },
                {
                  external: ports?.peers,
                  internal: 30303,
                  protocol: "udp",
                },
              ]
            : []),
        ]),
      },
      { parent: this }
    );

    this.registerOutputs([this.bscOptions, this.bscCommandArgs]);
  }
}
