import * as pulumi from "@pulumi/pulumi";
import * as docker from "@pulumi/docker";
import * as _ from "lodash";
import { input as inputs } from "@pulumi/docker/types";
import { BorOptions, optionsToArgs } from "../../bor";
import path from "path";

export interface DockerBorArgs {
  /*
    Sample: maticnetwork/bor:v0.2.14
   */
  imageName?: pulumi.Input<string>;
  existingNetwork?: pulumi.Input<string>;
  existingDataVolume?: pulumi.Input<string>;
  borOptions?: pulumi.Input<BorOptions>;
  extraVolumes?: pulumi.Input<pulumi.Input<inputs.ContainerVolume>[]>;
  /*
  Expose host ports: { [hostPort]: [containerPort]}
   */
  ports?: pulumi.Input<BorPorts | undefined>;
}

export interface BorPorts {
  rpc?: number;
  ws?: number;
  peers?: number;
}

const defaultOptions: BorOptions = {
  dataDir: "/var/bor/data",
};

const defaultImageName = "maticnetwork/bor:v0.2.14";

export class DockerBor extends pulumi.ComponentResource {
  public readonly borOptions: pulumi.Output<BorOptions>;
  public readonly cliArgs: pulumi.Output<string[]>;
  public readonly network?: docker.Network;
  public readonly container: docker.Container;
  public readonly dataVolume?: docker.Volume;

  public constructor(
    name: string,
    args: DockerBorArgs,
    opts?: pulumi.CustomResourceOptions
  ) {
    super("proxima:DockerBor", name, args, opts);

    if (args.existingNetwork == undefined)
      this.network = new docker.Network(name, {}, { parent: this });

    const networkName = args.existingNetwork ?? this.network!.name;

    const borImage = new docker.RemoteImage(
      name,
      {
        name: args.imageName ?? defaultImageName,
        keepLocally: true,
      },
      { parent: this }
    );

    this.borOptions = pulumi.Output.create(args.borOptions ?? {}).apply(
      (options) => _.merge(defaultOptions, options)
    );
    this.cliArgs = this.borOptions.apply((options) => optionsToArgs(options));

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
            containerPath: this.borOptions.apply((x) => x.dataDir!),
          } as pulumi.Input<inputs.ContainerVolume>,
        ].concat(x)
      );

    const resolvedArgs = pulumi.output(args);
    const entrypointPath = "/scripts/entrypoint.sh";
    this.container = new docker.Container(
      name,
      {
        image: borImage.name,
        hostname: name,
        domainname: name,
        restart: "always",
        networksAdvanced: [{ name: networkName }],
        envs: [],
        entrypoints: [entrypointPath],
        command: this.cliArgs,
        volumes: volumes,
        ports: resolvedArgs.ports?.apply((ports) => [
          ...(ports?.rpc ? [{ external: ports?.rpc, internal: 8545 }] : []),
          ...(ports?.ws ? [{ external: ports?.ws, internal: 8546 }] : []),
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
        uploads: [
          {
            file: entrypointPath,
            executable: true,
            source: path.resolve(__dirname, "entrypoint.sh"),
          },
        ],
      },
      { parent: this }
    );

    this.registerOutputs([this.borOptions, this.cliArgs]);
  }
}
