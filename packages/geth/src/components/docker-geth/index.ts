import * as pulumi from "@pulumi/pulumi";
import * as docker from "@pulumi/docker";
import * as _ from "lodash";
import { input as inputs } from "@pulumi/docker/types";
import { gethArgs, GethOptions } from "../../options";

export interface DockerGethArgs {
  imageName: pulumi.Input<string>;
  existingNetwork?: pulumi.Input<string>;
  existingDataVolume?: pulumi.Input<string>;
  gethOptions?: pulumi.Input<GethOptions>;
  extraVolumes?: pulumi.Input<pulumi.Input<inputs.ContainerVolume>[]>;
  /*
  Expose host ports: { [hostPort]: [containerPort]}
   */
  ports?: Record<number, number>;
}

const defaultGethOptions: GethOptions = {
  dataDir: "/vat/geth/data",
};

export class DockerGeth extends pulumi.ComponentResource {
  public readonly gethOptions: pulumi.Output<GethOptions>;
  public readonly gethCommandArgs: pulumi.Output<string[]>;
  public readonly network?: docker.Network;
  public readonly container: docker.Container;
  public readonly dataVolume?: docker.Volume;

  public constructor(
    name: string,
    args: DockerGethArgs,
    opts?: pulumi.CustomResourceOptions
  ) {
    super("proxima:DockerGeth", name, args, opts);

    if (args.existingNetwork == undefined)
      this.network = new docker.Network(name, {}, { parent: this });

    const networkName = args.existingNetwork ?? this.network!.name;

    const gethImage = new docker.RemoteImage(
      name,
      {
        name: args.imageName,
        keepLocally: true,
      },
      { parent: this }
    );

    this.gethOptions = pulumi.Output.create(args.gethOptions ?? {}).apply(
      (options) => _.merge(defaultGethOptions, options)
    );
    this.gethCommandArgs = this.gethOptions.apply((options) =>
      gethArgs(options)
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
            containerPath: this.gethOptions.apply((x) => x.dataDir!),
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
        command: this.gethCommandArgs,
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

    this.registerOutputs([this.gethOptions, this.gethCommandArgs]);
  }
}
