import * as k8sServices from "@proxima-one/pulumi-proxima-node";
import { AppDeployerBase, DeployParams } from "./base";

export class WebServiceDeployer extends AppDeployerBase {
  public deploy(app: WebService): DeployedServiceApp {
    const webServiceDeployer = new k8sServices.WebServiceDeployer(
      this.getDeployParams("web-service")
    );
    return webServiceDeployer.deploy({ publicHost: this.publicHost, ...app });
  }
}

export interface WebService extends k8sServices.WebService {}

export interface DeployedServiceApp extends k8sServices.DeployedServiceApp {}
