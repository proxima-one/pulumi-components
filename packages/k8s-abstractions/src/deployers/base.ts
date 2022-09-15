import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import _ from "lodash";

export interface DeployParameters {
  name: string;
  kubeconfig: pulumi.Input<string>;
}

export class KubernetesDeployer {
  protected readonly provider: k8s.Provider;

  public constructor(protected readonly params: DeployParameters) {
    this.provider = new k8s.Provider(
      this.params.name,
      { kubeconfig: this.params.kubeconfig },
      {}
    );
  }

  protected resourceOptions(
    opts?: pulumi.CustomResourceOptions
  ): pulumi.CustomResourceOptions {
    const result = opts ? _.clone(opts) : {};

    if (!result.provider) result.provider = this.provider;

    if (result.dependsOn)
      result.dependsOn = pulumi
        .output(result.dependsOn)
        .apply((x) =>
          Array.isArray(x) ? [...x, this.provider] : [x, this.provider]
        );
    else result.dependsOn = this.provider;

    return result;
  }
}
