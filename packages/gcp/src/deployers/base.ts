import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

export interface DeployParameters {
  name: string; // name of the account/provider
  project: pulumi.Input<string>;
  region: pulumi.Input<string>;
  zone: pulumi.Input<string>;
}

export class GcpDeployer {
  protected readonly provider: gcp.Provider;

  public constructor(protected readonly params: DeployParameters) {
    this.provider = new gcp.Provider(params.name, {
      region: params.region,
      zone: params.zone,
      project: params.project,
    });
  }
}
