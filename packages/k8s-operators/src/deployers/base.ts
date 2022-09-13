import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

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
}
