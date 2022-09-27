import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as _ from "lodash";
import { DeployParams, KubernetesDeployer } from "./base";
import { ImageRegistrySecret } from "./imageRegistry";
import { strict as assert } from "assert";

export interface ServiceDeployParameters extends DeployParams {
  namespace: pulumi.Input<string>;
  nodeSelectors?: pulumi.Input<Record<string, string>>;
  imageRegistrySecrets?: pulumi.Input<ImageRegistrySecret[]>;
}

export class KubernetesServiceDeployer extends KubernetesDeployer {
  protected readonly namespace: pulumi.Input<string>;
  protected readonly nodeSelectors?: pulumi.Input<Record<string, string>>;
  protected readonly imageRegistrySecrets?: pulumi.Input<ImageRegistrySecret[]>;

  public constructor(params: ServiceDeployParameters) {
    super(params);

    assert(params.namespace);
    this.namespace = params.namespace;
    this.nodeSelectors = params.nodeSelectors;
    this.imageRegistrySecrets = params.imageRegistrySecrets;
  }

  protected imagePullSecrets(opts?: {
    image?: pulumi.Input<string>;
    registry?: pulumi.Input<string>;
  }): pulumi.Input<{ name: string }[]> {
    if (!this.imageRegistrySecrets) {
      if (opts?.registry) throw new Error("no image registry secrets provided");

      return [];
    }

    const imageHost = opts?.image
      ? pulumi.output(opts.image).apply(getImageHost)
      : undefined;

    return pulumi
      .all([
        pulumi.output(this.imageRegistrySecrets),
        pulumi.output(this.namespace),
        imageHost,
      ])
      .apply(([s, namespace, imageHost]) => {
        let filteredSecrets = s.filter((x) => x.namespace == namespace);

        if (opts?.registry)
          filteredSecrets = filteredSecrets.filter(
            (x) => x.registry == opts.registry
          );

        if (imageHost)
          filteredSecrets = filteredSecrets.filter((x) =>
            x.hosts.includes(imageHost)
          );

        if (filteredSecrets.length == 0)
          throw new Error(
            `Image Pull Secret for ${opts?.image} ${opts?.registry} not found in namespace ${namespace}`
          );

        return filteredSecrets.map((x) => ({ name: x.secretName }));
      });
  }
}

function getImageHost(image: string): string | undefined {
  const segments = image.split("/");
  if (segments[0]?.includes(".")) return segments[0];
  return undefined;
}
