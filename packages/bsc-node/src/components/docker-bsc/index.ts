import * as pulumi from "@pulumi/pulumi";
import * as docker from "@pulumi/docker";
import * as _ from "lodash";
import { input as inputs } from "@pulumi/docker/types";
import { BscOptions, optionsToArgs } from "../../bsc/options";

export interface DockerGethArgs {
  imageName?: pulumi.Input<string>;
  existingNetwork?: pulumi.Input<string>;
  existingDataVolume?: pulumi.Input<string>;
  bscOptions?: pulumi.Input<BscOptions>;
  extraVolumes?: pulumi.Input<pulumi.Input<inputs.ContainerVolume>[]>;
  /*
  Expose host ports: { [hostPort]: [containerPort]}
   */
  ports?: Record<number, number>;
}

const defaultBscOptions: BscOptions = {
  dataDir: "/var/bsc/data",
};

const defaultImageName = "quay.io/proxima.one/bsc-geth:1.1.8";

export class DockerEth extends pulumi.ComponentResource {
  public readonly bscOptions: pulumi.Output<BscOptions>;
  public readonly bscCommandArgs: pulumi.Output<string[]>;
  public readonly container: docker.Container;
  public readonly network?: docker.Network;
  public readonly dataVolume?: docker.Volume;

  public constructor(
    name: string,
    args: DockerGethArgs,
    opts?: pulumi.CustomResourceOptions
  ) {
    super("proxima:DockerBsc", name, args, opts);

    if (args.existingNetwork == undefined)
      this.network = new docker.Network(name, {}, { parent: this });

    const networkName = args.existingNetwork ?? this.network!.name;

    const gethImage = new docker.RemoteImage(
      name,
      {
        name: args.imageName ?? defaultImageName,
        keepLocally: true,
      },
      { parent: this }
    );

    this.bscOptions = pulumi.Output.create(args.bscOptions ?? {}).apply(
      (options) => _.merge(defaultBscOptions, options)
    );
    this.bscCommandArgs = this.bscOptions.apply((options) =>
      optionsToArgs(options)
    );

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

    this.container = new docker.Container(
      name,
      {
        image: gethImage.name,
        restart: "on-failure",
        networksAdvanced: [{ name: networkName }],
        envs: [],
        command: this.bscCommandArgs,
        volumes: volumes,
        ports: Object.entries(args.ports ?? {}).map(
          ([hostPort, containerPort]) => {
            return {
              internal: containerPort,
              external: parseInt(hostPort),
            };
          }
        ),
      },
      { parent: this }
    );

    this.registerOutputs([this.bscOptions, this.bscCommandArgs]);
  }
}
