import * as pulumi from "@pulumi/pulumi";
import * as docker from "@pulumi/docker";
import * as _ from "lodash";
import { input as inputs } from "@pulumi/docker/types";
import { GethOptions, optionsToArgs } from "../../geth";

export interface DockerGethArgs {
  imageName: pulumi.Input<string>;
  existingNetwork?: pulumi.Input<string>;
  existingDataVolume?: pulumi.Input<string>;
  gethOptions?: pulumi.Input<GethOptions>;
  extraVolumes?: pulumi.Input<pulumi.Input<inputs.ContainerVolume>[]>;
  ports?: pulumi.Input<GethPorts | undefined>;
  jwtSecret?: pulumi.Input<string>;
}

export interface GethPorts {
  rpc?: number;
  ws?: number;
  peers?: number;
}

const defaultGethOptions: GethOptions = {
  dataDir: "/var/geth/data",
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

    const resolvedArgs = pulumi.output(args);

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
            containerPath: this.gethOptions.apply((x) => x.dataDir!),
          } as pulumi.Input<inputs.ContainerVolume>,
        ].concat(x)
      );

    const jwtFileUploads = pulumi
      .all([this.gethOptions, resolvedArgs])
      .apply(([opts, args]) => {
        if (opts.api?.auth?.jwtSecret && args.jwtSecret)
          return [{ content: args.jwtSecret, file: opts.api.auth.jwtSecret }];
        return [];
      });

    this.container = new docker.Container(
      name,
      {
        image: gethImage.name,
        restart: "always",
        hostname: `${name}`,
        domainname: `${name}`,
        networksAdvanced: [{ name: networkName }],
        envs: [],
        command: this.gethCommandArgs,
        volumes: volumes,
        uploads: jwtFileUploads,
        ports: resolvedArgs.ports?.apply((ports) => [
          ...(ports?.rpc
            ? [
                {
                  external: ports?.rpc,
                  internal: this.gethOptions.apply(
                    (x) => x.api?.http?.port ?? 8545
                  ),
                },
              ]
            : []),
          ...(ports?.ws
            ? [
                {
                  external: ports?.ws,
                  internal: this.gethOptions.apply(
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

    this.registerOutputs([this.gethOptions, this.gethCommandArgs]);
  }
}
