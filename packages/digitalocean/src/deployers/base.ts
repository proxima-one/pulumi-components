import * as pulumi from "@pulumi/pulumi";
import * as digitalocean from "@pulumi/digitalocean";

export interface DeployParameters {
  name: string; // name of the account/provider
  apiToken: pulumi.Input<string>;
  user: pulumi.Input<string>;
}

export class DigitaloceanDeployer {
  protected readonly provider: digitalocean.Provider;

  public constructor(protected readonly params: DeployParameters) {
    this.provider = new digitalocean.Provider(params.name, {
      token: params.apiToken,
    });
  }
}
