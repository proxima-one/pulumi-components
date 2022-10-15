import * as pulumi from "@pulumi/pulumi";
import * as docker from "@pulumi/docker";
import { input as inputs } from "@pulumi/docker/types";
import path from "path";
import * as fs from "fs";

export interface DockerPrysmArgs {
  imageName: pulumi.Input<string>;
  existingNetwork?: pulumi.Input<string>;
  existingDataVolume?: pulumi.Input<string>;
  extraVolumes?: pulumi.Input<pulumi.Input<inputs.ContainerVolume>[]>;
  executionEndpoint: pulumi.Input<string>;
  jwtSecret: pulumi.Input<string>;
  network: "goerli-prater" | "mainnet";
  checkpointUrl?: pulumi.Input<string>;
  ports?: pulumi.Input<PrysmPorts | undefined>;
}

export interface PrysmPorts {
  rpc?: number;
  p2pTcp?: number;
  p2pUdp?: number;
}

const dataDirInContainer = "/var/prysm/data";
const genesisFilePathInContainer = "/proxima/genesis.ssz";
const jwtSecretFile = "/proxima/jwt.hex";

export class DockerPrysm extends pulumi.ComponentResource {
  public readonly cliArgs: pulumi.Output<string[]>;
  public readonly network?: docker.Network;
  public readonly container: docker.Container;
  public readonly dataVolume?: docker.Volume;

  public constructor(
    name: string,
    args: DockerPrysmArgs,
    opts?: pulumi.CustomResourceOptions
  ) {
    super("proxima:DockerPrysm", name, args, opts);

    const resolvedArgs = pulumi.output(args);

    if (args.existingNetwork == undefined)
      this.network = new docker.Network(name, {}, { parent: this });

    const networkName = args.existingNetwork ?? this.network!.name;

    const prysmImage = new docker.RemoteImage(
      name,
      {
        name: args.imageName,
        keepLocally: true,
      },
      { parent: this }
    );

    const cliArgs: pulumi.Input<string>[] = [];

    cliArgs.push(`--accept-terms-of-use`);
    cliArgs.push(`--datadir=${dataDirInContainer}`);
    cliArgs.push(`--rpc-host=0.0.0.0`);
    cliArgs.push(`--grpc-gateway-host=0.0.0.0`);
    cliArgs.push(`--monitoring-host=0.0.0.0`);
    cliArgs.push(pulumi.interpolate`--jwt-secret=${jwtSecretFile}`);
    cliArgs.push(
      pulumi.interpolate`--execution-endpoint=${args.executionEndpoint}`
    );

    if (args.network == "goerli-prater") {
      cliArgs.push(`--genesis-state=${genesisFilePathInContainer}`);
      cliArgs.push(`--prater`);
    }

    if (args.checkpointUrl) {
      cliArgs.push(
        pulumi.interpolate`--checkpoint-sync-url=${args.checkpointUrl}`
      );
      cliArgs.push(
        pulumi.interpolate`--genesis-beacon-api-url=${args.checkpointUrl}`
      );
    }

    this.cliArgs = pulumi.all(cliArgs);
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
            containerPath: dataDirInContainer,
          } as pulumi.Input<inputs.ContainerVolume>,
        ].concat(x)
      );

    const localGenesisFilePath = path.resolve(
      __dirname,
      `networks/${args.network}/genesis.ssz`
    );
    const uploads: pulumi.Input<pulumi.Input<inputs.ContainerUpload>[]> = [];
    if (fs.existsSync(localGenesisFilePath))
      uploads.push({
        file: genesisFilePathInContainer,
        source: localGenesisFilePath,
      });

    uploads.push({
      file: jwtSecretFile,
      content: args.jwtSecret,
    });

    this.container = new docker.Container(
      name,
      {
        image: prysmImage.name,
        restart: "always",
        networksAdvanced: [{ name: networkName }],
        envs: [],
        command: this.cliArgs,
        volumes: volumes,
        ports: resolvedArgs.ports?.apply((ports) => [
          ...(ports?.rpc ? [{ external: ports?.rpc, internal: 4000 }] : []),
          ...(ports?.p2pTcp
            ? [{ external: ports?.p2pTcp, internal: 13000 }]
            : []),
          ...(ports?.p2pUdp
            ? [{ external: ports?.rpc, internal: 12000, protocol: "udp" }]
            : []),
        ]),
        uploads: uploads,
      },
      { parent: this }
    );

    this.registerOutputs([this.cliArgs]);
  }
}
