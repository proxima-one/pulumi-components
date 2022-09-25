import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as _ from "lodash";
import { ComputeResources } from "../interfaces";

export interface DeployParams {
  name: string;
  kubeconfig: pulumi.Input<string>;
}

const providersLookup: Record<string, k8s.Provider> = {};

export class KubernetesDeployer {
  protected readonly provider: k8s.Provider;

  public constructor(protected readonly params: DeployParams) {
    this.provider =
      providersLookup[params.name] ??
      (providersLookup[params.name] = new k8s.Provider(this.params.name, {
        kubeconfig: params.kubeconfig,
      }));
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

  protected parseResourceRequirements(
    req: ComputeResources
  ): k8s.types.input.core.v1.ResourceRequirements {
    const [cpu, memory] =
      typeof req == "string" ? req.split(",") : [req.cpu, req.memory];

    return {
      requests: {
        cpu: cpu.split("/")[0],
        memory: memory.split("/")[0],
      },
      limits: {
        cpu: cpu.split("/")[1],
        memory: memory.split("/")[1],
      },
    };
  }
}
